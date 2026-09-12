import {
  base64ToBytes,
  captureProofPhoto,
  contentTypeFor,
  extensionFor,
  isUsablePhoto,
  proofColumn,
  proofErrorMessage,
  proofKindForAction,
  proofPath,
  proofRequired,
  readProofBytes,
  uploadProof,
} from '@/features/driver/proofCapture';

jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  readAsStringAsync: jest.fn(),
}));

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

const fileSystem = jest.requireMock('expo-file-system/legacy') as {
  readAsStringAsync: jest.Mock;
};
const picker = jest.requireMock('expo-image-picker') as {
  requestCameraPermissionsAsync: jest.Mock;
  requestMediaLibraryPermissionsAsync: jest.Mock;
  launchCameraAsync: jest.Mock;
  launchImageLibraryAsync: jest.Mock;
};

// 2 KB de "foto": base64 de bytes conhecidos (precisa passar do mínimo de 1 KB)
const fotoGrande = `data:image/jpeg;base64,${Buffer.alloc(2048, 7).toString('base64')}`;

beforeEach(() => jest.clearAllMocks());

describe('qual comprovante cada passo exige', () => {
  it('embarcar pede comprovante de embarque; entregar pede o de entrega', () => {
    expect(proofKindForAction('picked_up')).toBe('pickup');
    expect(proofKindForAction('completed')).toBe('dropoff');
  });

  it('chegar, navegar ou problema nao pedem foto', () => {
    for (const acao of ['arrived', 'navigate', 'problem', 'pending']) {
      expect(proofKindForAction(acao)).toBeNull();
    }
  });

  it('a coluna no banco segue o tipo do comprovante', () => {
    expect(proofColumn('pickup', 'path')).toBe('pickup_proof_path');
    expect(proofColumn('dropoff', 'at')).toBe('dropoff_proof_at');
  });
});

describe('a creche manda (quando o comprovante e obrigatorio)', () => {
  it('sem configuracao carregada, nunca trava o motorista', () => {
    expect(proofRequired('pickup', null)).toBe(false);
    expect(proofRequired('dropoff', undefined)).toBe(false);
  });

  it('respeita o que a organizacao escolheu, separado por etapa', () => {
    const config = { proof_pickup_required: true, proof_dropoff_required: false };
    expect(proofRequired('pickup', config)).toBe(true);
    expect(proofRequired('dropoff', config)).toBe(false);
  });
});

describe('caminho do arquivo no bucket', () => {
  it('comeca com a organizacao (e o que a politica de storage usa para isolar)', () => {
    const caminho = proofPath('org-123', 'stop-9', 'pickup', 'file:///tmp/foto.jpg');
    expect(caminho.startsWith('org-123/')).toBe(true);
    expect(caminho).toContain('stop-9');
    expect(caminho).toContain('pickup-');
    expect(caminho.endsWith('.jpg')).toBe(true);
  });

  it('nao deixa dois-pontos nem ponto extra no horario (quebraria o caminho)', () => {
    const caminho = proofPath('org-1', 'stop-1', 'dropoff', 'file:///a/foto.jpeg', new Date('2026-09-12T14:31:07.123Z'));
    expect(caminho).not.toContain(':');
    expect(caminho.match(/\./g) ?? []).toHaveLength(1); // so o ponto da extensao
    expect(caminho).toContain('2026-09-12T14-31-07-123Z');
    expect(caminho.endsWith('.jpg')).toBe(true);
  });

  it('le a extensao mesmo com parametros na URL e cai em jpg quando nao ha', () => {
    expect(extensionFor('file:///foto.HEIC?x=1')).toBe('heic');
    expect(extensionFor('file:///foto.jpeg')).toBe('jpg');
    expect(extensionFor('file:///foto')).toBe('jpg');
    expect(contentTypeFor('png')).toBe('image/png');
    expect(contentTypeFor('jpg')).toBe('image/jpeg');
  });
});

describe('conversao da foto (base64 -> bytes)', () => {
  it('converte bytes conhecidos', () => {
    // "A" = 0x41 -> em base64 "QQ=="
    expect(Array.from(base64ToBytes('QQ=='))).toEqual([0x41]);
    expect(Array.from(base64ToBytes('QUI='))).toEqual([0x41, 0x42]);
  });

  it('aceita o prefixo data: e ignora espacos/quebras de linha', () => {
    expect(Array.from(base64ToBytes('data:image/png;base64,QUI='))).toEqual([0x41, 0x42]);
    expect(Array.from(base64ToBytes('QU\nI='))).toEqual([0x41, 0x42]);
  });

  it('reclama de base64 invalido em vez de gerar foto corrompida', () => {
    expect(() => base64ToBytes('QU@I=')).toThrow(/invalid/i);
  });

  it('foto pequena demais e tratada como vazia', () => {
    expect(isUsablePhoto(new Uint8Array(100))).toBe(false);
    expect(isUsablePhoto(new Uint8Array(5000))).toBe(true);
    expect(() => base64ToBytes(fotoGrande)).not.toThrow();
  });
});

describe('upload', () => {
  const clienteFalso = (resultado: { error: { message: string } | null }) => {
    const upload = jest.fn().mockResolvedValue(resultado);
    return { cliente: { storage: { from: jest.fn().mockReturnValue({ upload }) } } as never, upload, from: null };
  };

  it('le a foto e sobe no bucket certo com o tipo certo', async () => {
    fileSystem.readAsStringAsync.mockResolvedValue(fotoGrande);
    const { cliente, upload } = clienteFalso({ error: null });
    const caminho = await uploadProof(cliente, 'file:///tmp/foto.jpg', 'org/stop/pickup-x.jpg');
    expect(caminho).toBe('org/stop/pickup-x.jpg');
    expect(upload).toHaveBeenCalledWith('org/stop/pickup-x.jpg', expect.any(Uint8Array), {
      contentType: 'image/jpeg',
      upsert: false,
    });
  });

  it('erro do storage vira excecao (o chamador decide se enfileira)', async () => {
    fileSystem.readAsStringAsync.mockResolvedValue(fotoGrande);
    const { cliente } = clienteFalso({ error: { message: 'new row violates row-level security policy' } });
    await expect(uploadProof(cliente, 'file:///tmp/foto.jpg', 'outra-org/x.jpg')).rejects.toThrow(/row-level security/i);
  });

  it('foto vazia nao vai para a rede', async () => {
    fileSystem.readAsStringAsync.mockResolvedValue('data:image/jpeg;base64,QUI=');
    const { cliente, upload } = clienteFalso({ error: null });
    await expect(uploadProof(cliente, 'file:///tmp/foto.jpg', 'x.jpg')).rejects.toThrow(/empty/i);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('captura pela camera ou galeria', () => {
  it('camera sem permissao explica o motivo em vez de abrir vazio', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false });
    await expect(captureProofPhoto('camera')).rejects.toThrow(/permission/i);
  });

  it('motorista desistiu (canceled) devolve null, e nao erro', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
    picker.launchCameraAsync.mockResolvedValue({ canceled: true, assets: null });
    expect(await captureProofPhoto('camera')).toBeNull();
  });

  it('camera devolve o caminho local do arquivo', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
    picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///tmp/nova.jpg' }] });
    expect(await captureProofPhoto('camera')).toBe('file:///tmp/nova.jpg');
  });

  it('galeria pede a permissao certa', async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///tmp/antiga.png' }] });
    expect(await captureProofPhoto('library')).toBe('file:///tmp/antiga.png');
    expect(picker.requestMediaLibraryPermissionsAsync).toHaveBeenCalled();
  });
});

describe('mensagem para o motorista', () => {
  it('traduz permissao, foto vazia e falta de rede', () => {
    expect(proofErrorMessage(new Error('Camera permission denied.'))).toMatch(/Settings/i);
    expect(proofErrorMessage(new Error('The photo came out empty.'))).toMatch(/again/i);
    expect(proofErrorMessage(new Error('Network request failed'))).toMatch(/saved on your device/i);
  });

  it('sem erro conhecido, mostra a mensagem original (nunca vazia)', () => {
    expect(proofErrorMessage(new Error('Storage full'))).toBe('Storage full');
    expect(proofErrorMessage(null)).toBe('Could not attach the proof photo.');
  });
});

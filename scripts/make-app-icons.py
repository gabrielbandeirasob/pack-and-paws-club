#!/usr/bin/env python3
"""
Gera TODOS os icones/splash do app a partir de um logo em alta resolucao OU de uma marca limpa.

HISTORICO (por que existe)
  * 09/09/2026: o unico logo disponivel era o avatar do Instagram, 100x100 (`pack-paws-logo.jpg`),
    e o icone da loja (1024x1024) foi AMPLIADO dele — ficava macio (nitidez de bordas 2,00 contra
    42,8 do original pequeno).
  * 12/09/2026: achamos o logo do proprio site do cliente em 1320x1710 (mesma arte, 13x mais
    pixels). A marca foi reconstruida como cor chapada + alpha (mata o ruido do JPEG e mantem o
    anti-aliasing) e o icone passou a sair em resolucao quase nativa — nitidez 6,43 no mesmo
    1024. As fontes ficam em `assets/marca/` (dentro do repo): `logo-fonte-site-1320x1710.jpg`,
    `marca-escura.png` e `marca-clara.png`.

USO
  # 1) conferir o estado atual (nao altera nada)
  python3 scripts/make-app-icons.py --check

  # 2) RECOMENDADO: gerar da marca limpa (PNG com alpha), com tratamento por fundo
  python3 scripts/make-app-icons.py --marca /opt/data/pack-and-paws/assets/marca-escura.png
  #    icone e favicon: fundo creme + marca escura
  #    splash e foreground do Android: marca CLARA (o fundo deles e verde escuro)
  #    monocromatico do Android: marca branca (o sistema tinge)

  # 3) legado: gerar de um logo qualquer (recorte central quadrado)
  python3 scripts/make-app-icons.py --source /caminho/logo.png

  # opcional: gerar em outra pasta primeiro, para conferir
  python3 scripts/make-app-icons.py --marca marca.png --out /tmp/icones

REGRAS QUE O SCRIPT GARANTE (erros que a Apple/Google recusam)
  * icon.png 1024x1024 SEM transparencia (a App Store recusa icone com alpha)
  * android foreground/monochrome 432x432 com margem de seguranca (25%) para o recorte circular
  * splash 1024x1024 com fundo transparente
  * recorte central quadrado: imagem que nao e quadrada nao e esticada (evita logo achatado)

REQUISITOS: Pillow (`pip install pillow`); SVG: `pip install cairosvg`.
"""
from __future__ import annotations

import argparse
import io
import shutil
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit('Falta a biblioteca Pillow: pip install pillow')

RAIZ = Path(__file__).resolve().parent.parent
DESTINO_PADRAO = RAIZ / 'assets' / 'images'

REESCALA = getattr(getattr(Image, 'Resampling', Image), 'LANCZOS')

COR_FUNDO_CLARO = (247, 243, 232)    # creme das telas do app (#F7F3E8)
COR_MARCA_ESCURA = (54, 59, 40)      # verde escuro da marca (#363B28)
COR_FUNDO_ESCURO = (32, 53, 34)      # verde da marca, usado no splash e no Android (#203522)
COR_MARCA_CLARA = (247, 243, 232)    # a marca no fundo escuro: mesmo creme
COR_MONOCROMATICA = (255, 255, 255)  # camada que o Android tinge

# (nome, tamanho, fracao da altura ocupada pela marca, cor de fundo ou None, cor da marca, opaco?)
ALVOS = [
    ('icon.png', 1024, 0.74, COR_FUNDO_CLARO, COR_MARCA_ESCURA, True),
    ('splash-icon.png', 1024, 0.55, None, COR_MARCA_CLARA, False),
    ('android-icon-foreground.png', 432, 0.50, None, COR_MARCA_CLARA, False),
    ('android-icon-background.png', 432, None, COR_FUNDO_ESCURO, None, True),
    ('android-icon-monochrome.png', 432, 0.50, None, COR_MONOCROMATICA, False),
    ('favicon.png', 48, 0.80, None, COR_MARCA_ESCURA, False),
]

MINIMO_RECOMENDADO = 1024


def abrir_fonte(caminho: Path) -> Image.Image:
    if not caminho.exists():
        sys.exit(f'Logo nao encontrado: {caminho}')
    if caminho.suffix.lower() == '.svg':
        try:
            import cairosvg  # type: ignore
        except ImportError:
            sys.exit('Para SVG instale o cairosvg: pip install cairosvg')
        png = cairosvg.svg2png(url=str(caminho), output_width=2048, output_height=2048)
        return Image.open(io.BytesIO(png)).convert('RGBA')
    return Image.open(caminho).convert('RGBA')


def recorte_quadrado(imagem: Image.Image) -> Image.Image:
    """Recorta o centro em quadrado (nao estica: logo achatado e o erro classico)."""
    largura, altura = imagem.size
    lado = min(largura, altura)
    esquerda = (largura - lado) // 2
    topo = (altura - lado) // 2
    return imagem.crop((esquerda, topo, esquerda + lado, topo + lado))


def mascara_de(imagem: Image.Image) -> Image.Image:
    """
    Tira a FORMA da arte, jogando fora a cor:
    - se a imagem tem alpha (marca limpa), o alpha E a forma;
    - se e opaca (logo/foto), a forma vem do escuro (tinta) sobre claro.
    """
    if 'A' in imagem.getbands():
        alpha = imagem.getchannel('A')
        opacidade = alpha.tobytes()
        if opacidade and min(opacidade) < 250:  # tem transparencia de verdade: o alpha e a forma
            return alpha
    cinza = imagem.convert('L')
    # tinta escura = opaco. 198 = faixa util medida no logo do cliente (tinta ~57).
    tabela = [255 if v < 57 else max(0, min(255, int((255 - v) * 255 / 198))) for v in range(256)]
    return cinza.point(tabela)


def compor(marca: Image.Image, tamanho: int, fracao: float, cor_fundo, cor_marca, opaco: bool) -> Image.Image:
    base = Image.new('RGBA', (tamanho, tamanho), (0, 0, 0, 0))
    alvo_altura = max(1, int(tamanho * fracao))
    escala = alvo_altura / marca.size[1]
    nova = marca.resize((max(1, int(marca.size[0] * escala)), alvo_altura), REESCALA)
    if cor_marca is not None:
        pintada = Image.new('RGBA', nova.size, tuple(cor_marca) + (0,))
        pintada.putalpha(nova)
        nova = pintada
    base.paste(nova, ((tamanho - nova.size[0]) // 2, (tamanho - nova.size[1]) // 2), nova)
    if opaco:
        tela = Image.new('RGB', (tamanho, tamanho), tuple(cor_fundo or (255, 255, 255)))
        tela.paste(base, (0, 0), base)
        return tela
    return base


def verificar(pasta: Path) -> int:
    """Confere os assets atuais e avisa sobre o que a Apple/Google recusaria."""
    print(f'Conferindo {pasta}')
    problemas = 0
    for nome, tamanho, _fracao, _fundo, _marca, precisa_opaco in ALVOS:
        caminho = pasta / nome
        if not caminho.exists():
            print(f'  FALTA  {nome}')
            problemas += 1
            continue
        with Image.open(caminho) as imagem:
            largura, altura = imagem.size
            tem_alpha = imagem.mode in ('RGBA', 'LA') or (imagem.mode == 'P' and 'transparency' in imagem.info)
            ok_tamanho = largura >= tamanho and altura >= tamanho and largura == altura
            ok_opaco = (not tem_alpha) if precisa_opaco else tem_alpha
            if not (ok_tamanho and ok_opaco):
                problemas += 1
            print(
                f'  {"OK   " if ok_tamanho and ok_opaco else "ATENCAO"} {nome:32} {largura}x{altura} {imagem.mode:5} '
                f'alpha={"sim" if tem_alpha else "nao":3} minimo={tamanho}x{tamanho} '
                f'{"opaco" if precisa_opaco else "transparente"}'
            )

    logo = pasta / 'pack-paws-logo.jpg'
    if logo.exists():
        with Image.open(logo) as imagem:
            if min(imagem.size) < MINIMO_RECOMENDADO:
                problemas += 1
                print(
                    f'  ATENCAO logo de origem {imagem.size[0]}x{imagem.size[1]} — abaixo de {MINIMO_RECOMENDADO}px. '
                    'Use --marca com a marca limpa de /opt/data/pack-and-paws/assets/.'
                )
    print('resumo:', 'tudo certo' if problemas == 0 else f'{problemas} ponto(s) de atencao')
    return 0 if problemas == 0 else 1


def gerar_marca(marca: Path, destino: Path) -> None:
    alpha = mascara_de(abrir_fonte(marca))
    caixa = alpha.getbbox()
    if caixa:
        alpha = alpha.crop(caixa)
    print(f'marca: {alpha.size[0]}x{alpha.size[1]} (forma recortada)')
    destino.mkdir(parents=True, exist_ok=True)
    for nome, tamanho, fracao, cor_fundo, cor_marca, opaco in ALVOS:
        if fracao is None:
            imagem = Image.new('RGB', (tamanho, tamanho), tuple(cor_fundo))
        else:
            imagem = compor(alpha, tamanho, fracao, cor_fundo, cor_marca, opaco)
        imagem.save(destino / nome)
        print(f'  gerado {nome:32} {tamanho}x{tamanho} {"opaco" if opaco else "transparente"}')


def gerar_legado(origem: Path, destino: Path) -> None:
    base = recorte_quadrado(abrir_fonte(origem))
    if min(base.size) < MINIMO_RECOMENDADO:
        print(f'AVISO: origem {base.size[0]}x{base.size[1]} — abaixo de {MINIMO_RECOMENDADO}px. O icone sai ampliado (macio).')
    destino.mkdir(parents=True, exist_ok=True)
    for nome, tamanho, _fracao, _fundo, _marca, precisa_opaco in ALVOS:
        margem = 0.25 if nome in ('android-icon-foreground.png', 'android-icon-monochrome.png') else 0.0
        if margem > 0:
            util = max(1, int(tamanho * (1 - margem)))
            reduzida = base.resize((util, util), REESCALA)
            imagem = Image.new('RGBA', (tamanho, tamanho), (0, 0, 0, 0))
            imagem.paste(reduzida, ((tamanho - util) // 2, (tamanho - util) // 2), reduzida)
        else:
            imagem = base.resize((tamanho, tamanho), REESCALA)
        if precisa_opaco:
            if nome == 'android-icon-background.png':
                imagem = Image.new('RGB', (tamanho, tamanho), COR_FUNDO_ESCURO)
            else:
                tela = Image.new('RGB', imagem.size, COR_FUNDO_CLARO)
                tela.paste(imagem, (0, 0), imagem)
                imagem = tela
        imagem.save(destino / nome)
        print(f'  gerado {nome:32} {tamanho}x{tamanho}')
    if origem.suffix.lower() in {'.png', '.jpg', '.jpeg'}:
        copia = destino / f'pack-paws-logo{origem.suffix.lower()}'
        if origem.resolve() != copia.resolve():
            shutil.copy2(origem, copia)
            print(f'  copiado {copia.name} (origem do que foi gerado)')


def main() -> int:
    parser = argparse.ArgumentParser(description='Gera os icones do app a partir do logo em alta ou da marca limpa.')
    parser.add_argument('--source', type=Path, help='logo em alta (PNG/JPG/SVG) — modo legado')
    parser.add_argument('--marca', type=Path, help='marca limpa em PNG com alpha — modo recomendado')
    parser.add_argument('--out', type=Path, default=DESTINO_PADRAO, help='pasta de destino')
    parser.add_argument('--check', action='store_true', help='apenas conferir os icones atuais')
    args = parser.parse_args()

    if args.check or (not args.source and not args.marca):
        return verificar(args.out)
    if args.marca:
        gerar_marca(args.marca, args.out)
    else:
        gerar_legado(args.source, args.out)
    print('\nConferindo o resultado:')
    return verificar(args.out)


if __name__ == '__main__':
    raise SystemExit(main())

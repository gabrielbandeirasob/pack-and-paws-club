#!/usr/bin/env python3
"""
Gera TODOS os icones/splash do app a partir de um logo em alta resolucao.

Por que existe: o logo que veio do Instagram tem apenas 100x100 (`pack-paws-logo.jpg`), e o
icone da loja (1024x1024) foi ampliado dele — fica macio. Quando o cliente enviar o logo
original (SVG ou PNG grande), rode este script e tudo e regenerado no tamanho certo.

USO
  # 1) conferir o estado atual (nao altera nada)
  python3 scripts/make-app-icons.py --check

  # 2) gerar a partir do logo em alta
  python3 scripts/make-app-icons.py --source /caminho/logo.png
  python3 scripts/make-app-icons.py --source /caminho/logo.svg   # SVG precisa de cairosvg

  # opcional: gerar em outra pasta primeiro, para conferir
  python3 scripts/make-app-icons.py --source logo.png --out /tmp/icones

REGRAS QUE O SCRIPT GARANTE (erros que a Apple/Google recusam)
  * icon.png 1024x1024 SEM transparencia (a App Store recusa icone com alpha)
  * android foreground/monochrome 432x432 com margem de seguranca (25%) para o recorte circular
  * splash 1024x1024 com fundo transparente
  * recorte central quadrado: imagem que nao e quadrada nao e esticada (evita logo achatado)

REQUISITOS: Pillow (`pip install pillow`); SVG: `pip install cairosvg`.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit('Falta a biblioteca Pillow: pip install pillow')

RAIZ = Path(__file__).resolve().parent.parent
DESTINO_PADRAO = RAIZ / 'assets' / 'images'

# Pillow novo expõe Image.Resampling; antigo, o atalho direto. Serve nos dois.
REESCALA = getattr(getattr(Image, 'Resampling', Image), 'LANCZOS')

# (nome, tamanho minimo, precisa ser opaco?) — no Android o Expo aceita >= 432 (o padrao
# adaptativo e 108dp: 432px em xxxhdpi); abaixo disso o sistema amplia e borra.
ALVOS = [
    ('icon.png', 1024, True),
    ('splash-icon.png', 1024, False),
    ('android-icon-foreground.png', 432, False),
    ('android-icon-background.png', 432, True),
    ('android-icon-monochrome.png', 432, False),
    ('favicon.png', 48, False),
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
        import io

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


def com_margem(imagem: Image.Image, tamanho: int, margem: float = 0.0) -> Image.Image:
    """Redimensiona (Lanczos) e, se pedido, deixa margem de seguranca em volta."""
    if margem <= 0:
        return imagem.resize((tamanho, tamanho), REESCALA)
    util = max(1, int(tamanho * (1 - margem)))
    reduzida = imagem.resize((util, util), REESCALA)
    tela = Image.new('RGBA', (tamanho, tamanho), (0, 0, 0, 0))
    deslocamento = (tamanho - util) // 2
    tela.paste(reduzida, (deslocamento, deslocamento), reduzida)
    return tela


def opaco(imagem: Image.Image, cor_fundo: tuple[int, int, int] = (255, 255, 255)) -> Image.Image:
    """Tira a transparencia (a App Store recusa icone com alpha)."""
    tela = Image.new('RGB', imagem.size, cor_fundo)
    tela.paste(imagem, (0, 0), imagem)
    return tela


def verificar(pasta: Path) -> int:
    """Confere os assetos atuais e avisa sobre o que a Apple/Google recusaria."""
    print(f'Conferindo {pasta}')
    problemas = 0
    for nome, tamanho, precisa_opaco in ALVOS:
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
            estado = 'OK   ' if (ok_tamanho and ok_opaco) else 'ATENCAO'
            if not (ok_tamanho and ok_opaco):
                problemas += 1
            print(
                f'  {estado} {nome:32} {largura}x{altura} {imagem.mode:5} '
                f'alpha={"sim" if tem_alpha else "nao":3} minimo={tamanho}x{tamanho} '
                f'{"opaco" if precisa_opaco else "transparente"}'
            )

    logo = pasta / 'pack-paws-logo.jpg'
    if logo.exists():
        with Image.open(logo) as imagem:
            largura, altura = imagem.size
            if min(largura, altura) < MINIMO_RECOMENDADO:
                problemas += 1
                print(
                    f'  ATENCAO logo de origem {largura}x{altura} — abaixo de {MINIMO_RECOMENDADO}px. '
                    'O icone da loja fica ampliado/macio: peca o logo original (SVG ou PNG grande).'
                )
    print('resumo:', 'tudo certo' if problemas == 0 else f'{problemas} ponto(s) de atencao')
    return 0 if problemas == 0 else 1


def gerar(origem: Path, destino: Path) -> None:
    base = recorte_quadrado(abrir_fonte(origem))
    if min(base.size) < MINIMO_RECOMENDADO:
        print(
            f'AVISO: origem {base.size[0]}x{base.size[1]} — abaixo de {MINIMO_RECOMENDADO}px. '
            'O icone vai sair ampliado (macio). O ideal e pedir o logo original ao cliente.'
        )
    destino.mkdir(parents=True, exist_ok=True)

    for nome, tamanho, precisa_opaco in ALVOS:
        # foreground do Android precisa de margem (o sistema recorta em circulo)
        margem = 0.25 if nome == 'android-icon-foreground.png' or nome == 'android-icon-monochrome.png' else 0.0
        imagem = com_margem(base, tamanho, margem)
        if precisa_opaco:
            if nome == 'android-icon-background.png':
                imagem = Image.new('RGB', (tamanho, tamanho), (32, 53, 34))  # verde da marca
            else:
                imagem = opaco(imagem)
        imagem.save(destino / nome)
        print(f'  gerado {nome:32} {tamanho}x{tamanho}')

    # guarda a origem para referencia/auditoria do que foi usado (a menos que ja esteja la)
    if origem.suffix.lower() in {'.png', '.jpg', '.jpeg'}:
        copia = destino / f'pack-paws-logo{origem.suffix.lower()}'
        if origem.resolve() != copia.resolve():
            shutil.copy2(origem, copia)
            print(f'  copiado {copia.name} (origem do que foi gerado)')


def main() -> int:
    parser = argparse.ArgumentParser(description='Gera os icones do app a partir do logo em alta.')
    parser.add_argument('--source', type=Path, help='logo em alta (PNG ou SVG)')
    parser.add_argument('--out', type=Path, default=DESTINO_PADRAO, help='pasta de destino')
    parser.add_argument('--check', action='store_true', help='apenas conferir os icones atuais')
    args = parser.parse_args()

    if args.check or not args.source:
        return verificar(args.out)
    gerar(args.source, args.out)
    print('\nConferindo o resultado:')
    return verificar(args.out)


if __name__ == '__main__':
    raise SystemExit(main())

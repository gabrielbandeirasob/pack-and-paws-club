#!/usr/bin/env node
/**
 * Pega nomes de arquivo que colidem ignorando maiuscula/minuscula (ex: dogPicker.ts x DogPicker.tsx).
 *
 * Por que existe: o app e compilado no macOS (e o app roda no iPhone), onde "dogPicker" e
 * "DogPicker" sao o MESMO arquivo. Dois arquivos assim quebram o import e a tela — e no Linux
 * (onde os testes rodam) o erro nao aparece. Este check roda no CI e mata a classe de bug.
 */
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const IGNORAR = new Set(['node_modules', '.git', 'dist', '.expo', 'ios', 'android', 'coverage'])
const RECORTES = ['features', 'app', 'lib', '__tests__', 'scripts', 'components', 'assets']

function varrer(dir, achados = new Map()) {
  for (const item of readdirSync(dir)) {
    if (IGNORAR.has(item)) continue
    const caminho = join(dir, item)
    if (statSync(caminho).isDirectory()) {
      varrer(caminho, achados)
    } else {
      // sem extensao: o import resolve ignorando .ts/.tsx (dogPicker.ts x DogPicker.tsx colidem)
      const chave = relative(process.cwd(), caminho).toLowerCase().replace(/\.(tsx?|jsx?|mjs|cjs)$/, '')
      if (!achados.has(chave)) achados.set(chave, [])
      achados.get(chave).push(relative(process.cwd(), caminho))
    }
  }
  return achados
}

const achados = varrer(process.cwd())
const colisoes = [...achados.values()].filter((nomes) => nomes.length > 1)

if (colisoes.length === 0) {
  console.log('OK: nenhum arquivo colide so por maiuscula/minuscula')
  process.exit(0)
}

console.log('ERRO: estes arquivos colidem no macOS/Windows (mesmo nome ignorando maiuscula):')
for (const nomes of colisoes) {
  console.log('  - ' + nomes.join('  ×  '))
}
console.log('\nRenomeie um deles (o app e compilado no macOS, onde os dois viram o mesmo arquivo).')
process.exit(1)

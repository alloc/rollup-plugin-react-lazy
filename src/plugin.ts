import type { Program } from 'estree'
import type { Plugin } from 'rollup'
import MagicString from 'magic-string'
import replaceAll from 'replace-string'
import dedent from 'dedent'
import path from 'path'
import uid from 'uid'
import fs from 'fs'

const { readFile } = fs.promises

const runtimeId = 'react-lazy-runtime'
const nodeModulesId = path.join(path.sep, 'node_modules', path.sep)

export default (config: Config): Plugin => {
  const { redirect = id => id } = config

  const configId = uid()
  const lazyModules = new Map<string, LazyModule>()
  const providers = Object.entries(config.providers).map(
    ([name, root]): Provider => ({
      name,
      root: path.resolve(root),
    })
  )

  return {
    name: 'react-lazy',
    resolveId(id) {
      return id == runtimeId || id.startsWith(runtimeId) ? id : null
    },
    async load(id) {
      if (id == runtimeId) {
        return replaceAll(
          await readFile(
            path.join(__dirname, '../template/runtime.js'),
            'utf8'
          ),
          '{{resolver}}',
          redirect(path.resolve(config.resolver))
        )
      }
      const lazyModule = lazyModules.get(id)
      if (lazyModule) {
        const { source, provider } = lazyModule

        let input = await readFile(source, 'utf8')
        if (/\.tsx?$/.test(source)) {
          input = await getCompileTs()(input)
        }

        const moduleId = path.relative(provider.root, source)
        const exportIds: string[] = []

        const ast = catchParseErrors(
          (): Program => this.parse(input, { ranges: true }) as any,
          source
        )

        for (const node of ast.body) {
          if (node.type == 'ExportNamedDeclaration') {
            for (const spec of node.specifiers) {
              const exportId = spec.exported.name
              if (/^([A-Z]|use[A-Z])/.test(exportId)) {
                exportIds.push(exportId)
              }
            }
          }
        }

        return dedent`
          import * as L from '${runtimeId}'

          const providers = {
            ${providers
              .map(
                p =>
                  `${p.name}: () => import('${redirect(
                    path.join(p.root, moduleId)
                  )}'),`
              )
              .join('\n')}
          }

          ${exportIds
            .map(exportId => {
              const type = /[A-Z]/.test(exportId[0]) ? 'Component' : 'Hook'
              return `export const ${exportId} = L.createLazy${type}(providers, '${exportId}')`
            })
            .join('\n')}
        `
      }
      return null
    },
    async transform(code, filename) {
      if (/\.[tj]sx?$/.test(filename) && filename.indexOf(nodeModulesId) < 0) {
        let editor: MagicString | undefined

        const ast = catchParseErrors(
          (): Program => this.parse(code, { ranges: true }) as any,
          filename
        )

        for (const node of ast.body) {
          if (node.type == 'ImportDeclaration') {
            let source = node.source.raw!
            source = replaceAll(source, source[0], '')

            if (/^\.\.?(\/|$)/.test(source)) {
              const resolved = await this.resolve(source, filename)
              if (resolved) {
                source = resolved.id
              } else continue
            } else continue

            const provider = providers.find(provider =>
              source.startsWith(provider.root + path.sep)
            )

            if (provider) {
              const moduleId = path.relative(provider.root, source)
              const isLazy = providers.every(provider =>
                fs.existsSync(path.join(provider.root, moduleId))
              )
              if (!isLazy) {
                continue // Module must exist in all providers.
              }

              const lazySource = [
                runtimeId,
                configId,
                replaceAll(moduleId, path.sep, '/'),
              ].join('/')

              if (!lazyModules.has(lazySource))
                lazyModules.set(lazySource, {
                  source,
                  provider,
                })

              if (!editor) {
                editor = new MagicString(code)
              }

              const [start, end] = node.source.range!
              editor.overwrite(start + 1, end - 1, lazySource)
            }
          }
        }

        if (editor) {
          return {
            code: editor.toString(),
            map: editor.generateMap(),
          }
        }
      }
      return null
    },
  }
}

interface Config {
  /**
   * The module that exports the `useModuleProvider` hook, which decides
   * where lazy components/hooks are loaded from.
   */
  resolver: string
  /**
   * The directories (relative to working directory) that contain modules with
   * identical filenames and exports.
   */
  providers: { [name: string]: string }
  /**
   * For rewriting absolute paths injected by this plugin.
   *
   * Used by `vite-plugin-react-lazy`.
   */
  redirect?: (id: string) => string
}

type Provider = {
  name: string
  root: string
}

type LazyModule = {
  source: string
  provider: Provider
}

let compileTs: (input: string) => Promise<string>
function getCompileTs() {
  if (!compileTs) {
    const { transform } = require('esbuild') as typeof import('esbuild')
    const options: import('esbuild').TransformOptions = {
      target: 'esnext',
      format: 'esm',
      loader: 'tsx',
    }
    compileTs = async input => (await transform(input, options)).js
  }
  return compileTs
}

function catchParseErrors<T>(parseFn: () => T, filename: string): T {
  try {
    return parseFn()
  } catch (e) {
    console.log('parse failed: %O', e)
    throw Error(`Failed to parse "${filename}"`)
  }
}

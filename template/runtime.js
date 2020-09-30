import React from 'react'
import { useModuleProvider } from '{{resolver}}'

const cache = new Map()

export function createLazyComponent(providers, exportId) {
  const LazyComponent = React.forwardRef((props, ref) => {
    const providerId = useModuleProvider()
    const Component = fetchExport(providers[providerId], exportId)
    return React.createElement(Component, { ref, ...props })
  })
  LazyComponent.displayName = `Lazy(${exportId})`
  return LazyComponent
}

export function createLazyHook(providers, exportId) {
  return function useLazyHook(...args) {
    const providerId = useModuleProvider()
    const useLoadedHook = fetchExport(providers[providerId], exportId)
    return useLoadedHook(...args)
  }
}

function fetchExport(provider, exportId) {
  let module = cache.get(provider)
  if (!module) {
    cache.set(
      provider,
      (module = provider().then(module => {
        cache.set(provider, module)
      }))
    )
  }
  if (module instanceof Promise) {
    throw module
  }
  return module[exportId]
}

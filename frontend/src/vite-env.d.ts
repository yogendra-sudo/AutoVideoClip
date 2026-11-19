/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** PostHog project API key（Public key，Can be packaged into the front end）。Not set upThen disable tracking points。 */
  readonly VITE_PUBLIC_POSTHOG_KEY?: string
  /** PostHog Instance Address，US: https://us.i.posthog.com，EU: https://eu.i.posthog.com */
  readonly VITE_PUBLIC_POSTHOG_HOST?: string
  /** Sentry DSN（PublicClient DSN）。Not set upThen report the crash no-op。 */
  readonly VITE_PUBLIC_SENTRY_DSN?: string
  /** Injected during packagingApplicationVersion，Give Sentry release Use。 */
  readonly VITE_APP_VERSION?: string
  /** Dev-only flag overrides, `name=value` comma separated. Ignored in production builds. */
  readonly VITE_FLAGS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.jpg' {
  const content: string
  export default content
}

declare module '*.jpeg' {
  const content: string
  export default content
}

declare module '*.png' {
  const content: string
  export default content
}

declare module '*.svg' {
  const content: string
  export default content
}

declare module '*.webm?url' {
  const src: string
  export default src
}

declare module '*.mp4?url' {
  const src: string
  export default src
}

declare module '*.svg?react' {
  import React from 'react'
  const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement>>
  export default ReactComponent
}
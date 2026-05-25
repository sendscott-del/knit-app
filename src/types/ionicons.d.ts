import type { DetailedHTMLProps, HTMLAttributes } from 'react'

type IonIconElementProps = DetailedHTMLProps<
  HTMLAttributes<HTMLElement> & {
    name?: string
    size?: 'small' | 'large'
    src?: string
    ios?: string
    md?: string
  },
  HTMLElement
>

// React 18 path
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'ion-icon': IonIconElementProps
    }
  }
}

// React 19 path — JSX namespace lives under React.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ion-icon': IonIconElementProps
    }
  }
}

export {}

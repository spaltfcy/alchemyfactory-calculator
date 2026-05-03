declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

declare module 'react' {
  const React: any;
  export default React;
  export const useEffect: any;
  export const useMemo: any;
  export const useState: any;
}

declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}

declare module 'react-dom/client' {
  export const createRoot: any;
}

declare module '*.css';

declare const process: {
  env: Record<string, string | undefined>;
};

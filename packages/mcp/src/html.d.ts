/** esbuild bundles *.html imports as text (see build.mjs loader). */
declare module '*.html' {
  const text: string;
  export default text;
}

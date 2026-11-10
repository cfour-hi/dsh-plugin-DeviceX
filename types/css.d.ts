/**
 * CSS files are compiled into the client bundle as strings by both build
 * engines (esbuild `text` loader / concat inlining), never fetched at runtime.
 */
declare module "*.css" {
  const text: string;
  export default text;
}

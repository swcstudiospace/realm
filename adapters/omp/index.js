// Realm Omp extension shim. Managed by `realm host install omp`: do not edit.
// `realm host install omp` replaces the single token below with the file URL of the built Realm extension,
// as a JSON string literal; Omp loads this file from its extensions directory and calls the default export.
export default async function realmExtension(pi) {
  const { default: factory } = await import(@realm:extension-url@);
  await factory(pi);
}

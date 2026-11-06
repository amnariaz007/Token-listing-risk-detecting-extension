/** pdfkit reads its font files from disk, so it must not be bundled. */
export default {
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ["pdfkit"],
};

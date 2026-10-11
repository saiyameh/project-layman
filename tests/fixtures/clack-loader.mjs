const mock = new URL('./clack-prompts-mock.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@clack/prompts') return { url: mock, shortCircuit: true };
  return nextResolve(specifier, context);
}

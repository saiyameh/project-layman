const clack = new URL('./clack-prompts-mock.mjs', import.meta.url).href;
const contribution = new URL('./start-menu-contribution-mock.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@clack/prompts') return { url: clack, shortCircuit: true };
  if (specifier === './contribute/index.js' && context.parentURL?.endsWith('/dist/index.js')) {
    return { url: contribution, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

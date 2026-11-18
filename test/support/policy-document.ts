// The one shared opt-out member of a policy document. A test that starts a real daemon for a purpose that is not
// capability tokens spreads this into the policy it writes, so its result does not depend on the default of
// capabilityTokens.mode. A test that is about tokens must not use it: it writes its own capabilityTokens member.

export const CAPABILITY_TOKENS_OFF: { readonly capabilityTokens: { readonly mode: "off" } } = Object.freeze({
  capabilityTokens: Object.freeze({ mode: "off" }),
});

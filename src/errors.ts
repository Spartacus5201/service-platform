// A UserError is a problem the person can fix (a missing reason, a wrong file, a rule that refuses): its message is
// written for them and shown as is. Anything else is a bug: logged, and the person sees "Something went wrong".
export class UserError extends Error {
  constructor(message?: string) { super(message); this.name = new.target.name; }
}
export const isUserError = (e: unknown): e is UserError => e instanceof UserError;

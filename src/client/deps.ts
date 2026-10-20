/**
 * The only two modules the shell seeds for a plugin bundle.
 *
 * Every other file imports them from here, so the built bundle holds exactly one
 * binding for each — the smoke test reads `primitives.<Name>` off the output.
 */
import * as react from "react";
import * as primitives from "@deepseek-ai/dsh-client-ui-primitives";

export { react, primitives };
export const h = react.createElement;
export const Fragment = react.Fragment;

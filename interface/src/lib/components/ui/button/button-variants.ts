import { type WithElementRef } from "$lib/utils.js";
import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
import { type VariantProps, tv } from "tailwind-variants";

/*
 * Flat-grammar overrides (Live / Hybrid skins — see ui-architecture §8.1).
 * This is a .ts file with no <style>, so the overrides ride Tailwind
 * arbitrary variants: `flat:…` compiles to
 * `html[data-grammar=flat] .cls` — (0,2,1), which outranks every plain,
 * `hover:` and `dark:` utility in the same string (≤ (0,2,0)) and the
 * stacked `…:hover:` forms (0,3,1) outrank `dark:hover:` (0,3,0). Under
 * GRATICULE (no data-grammar) none of these match, so nothing changes.
 * Field = --secondary / --surface-well in a 1px --line-strong frame, 2px
 * corners, no shadow; destructive = ChosenRecord with the dark ON glyph;
 * disabled = ControlOffDisabledForeground on the same field, never opacity.
 */
export const buttonVariants = tv({
	base: "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-all focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 flat:rounded-[2px] flat:shadow-none flat:disabled:opacity-100 flat:disabled:text-(--flat-disabled-fg) flat:aria-disabled:opacity-100 flat:aria-disabled:text-(--flat-disabled-fg)",
	variants: {
		variant: {
			default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 flat:bg-secondary flat:text-foreground flat:border flat:border-line-strong",
			destructive:
				"bg-destructive shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60 text-white flat:bg-(--act-rec) flat:text-(--flat-on-fg) flat:border flat:border-line-strong",
			outline:
				"bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 border flat:bg-surface-well flat:text-foreground flat:border-line-strong flat:hover:bg-secondary flat:hover:text-foreground",
			secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
			ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
			link: "text-primary underline-offset-4 hover:underline",
		},
		size: {
			default: "h-9 px-4 py-2 has-[>svg]:px-3",
			sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
			lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
			icon: "size-9",
		},
	},
	defaultVariants: {
		variant: "default",
		size: "default",
	},
});

export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
	WithElementRef<HTMLAnchorAttributes> & {
		variant?: ButtonVariant;
		size?: ButtonSize;
	};

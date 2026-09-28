import { type VariantProps, tv } from "tailwind-variants";

/*
 * Flat-grammar overrides (Live / Hybrid skins — see ui-architecture §8.1)
 * ride Tailwind arbitrary variants, exactly as in button-variants.ts:
 * `flat:…` → `html[data-grammar=flat] .cls` (0,2,1),
 * which outranks the plain / `dark:` / `[a&]:hover:` utilities beside it and
 * matches nothing under GRATICULE. Badge = a small field: --secondary or
 * --surface-well in a 1px --line-strong frame, 2px corners; destructive =
 * ChosenRecord with the dark ON glyph.
 */
export const badgeVariants = tv({
	base: "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium transition-[color,box-shadow] focus-visible:ring-[3px] [&>svg]:pointer-events-none [&>svg]:size-3 flat:rounded-[2px] flat:border-line-strong",
	variants: {
		variant: {
			default:
				"bg-primary text-primary-foreground [a&]:hover:bg-primary/90 border-transparent flat:bg-secondary flat:text-foreground",
			secondary:
				"bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90 border-transparent flat:text-foreground",
			destructive:
				"bg-destructive [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/70 border-transparent text-white flat:bg-(--act-rec) flat:text-(--flat-on-fg)",
			outline: "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground flat:bg-surface-well",
		},
	},
	defaultVariants: {
		variant: "default",
	},
});

export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

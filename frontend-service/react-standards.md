---
name: react
description: Frontend engineering standards for plain React projects (Vite, CRA, or any non-meta-framework setup) — component architecture, hooks discipline (useMemo/useCallback/useEffect misuse), WCAG 2.1 AA accessibility, and Core Web Vitals performance (LCP, CLS, INP) per https://pagespeed.web.dev/. Use this skill whenever setting up contributor rules for a React project, writing or reviewing components/hooks, deciding whether a memoization or an effect is actually needed, auditing a React app's Lighthouse score, choosing a state-management approach, or generating a CLAUDE.md/.cursor/AGENTS.md rules file for a React codebase not using Next.js.
---

# React Frontend Standards

For plain React projects — Vite, Create React App, or any setup without a meta-framework (see the `nextjs` skill instead if the project uses Next.js). Extends the framework-agnostic rules in the `core-standards` skill with React-specific APIs, hook conventions, and tooling. Because there's no framework layer doing image optimization, routing, or SSR for you, several concerns that Next.js handles automatically (image loading, code-splitting, font loading) are the app's own responsibility here — this skill is explicit about how to do them by hand.

## When to use this skill

- Setting up or reviewing contributor rules for a new or existing React (Vite/CRA) project.
- Writing or reviewing components, custom hooks, or state-management code.
- Deciding whether a `useMemo`/`useCallback`/`React.memo` is earning its keep, or is just noise.
- Investigating unnecessary re-renders or a slow interaction with React DevTools Profiler.
- Investigating a React app's Lighthouse/PageSpeed score.
- Choosing between local state, lifted state, Context, or an external store (Zustand/Redux).
- Generating a `CLAUDE.md`/`.cursor/rules`/`AGENTS.md` for a React codebase.

## Quick reference

| Concern        | Rule                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rendering      | Function components + hooks; no class components in new code                                                                                                   |
| Code-splitting | `React.lazy` + `<Suspense>` for routes and heavy, non-critical components                                                                                      |
| Memoization    | `useMemo`/`useCallback`/`React.memo` only for measured, expensive work or to stabilize props into memoized children — not by default                           |
| Images         | Explicit `width`/`height`, `loading="lazy"` below the fold, `srcset`/`sizes` for responsive sources — no built-in image component, so this is manual           |
| Long lists     | Virtualize with `react-window`/`@tanstack/react-virtual` past a few hundred rows                                                                               |
| State          | Local `useState` first; lift only as far as needed; Context for low-frequency shared state; an external store (Zustand/Redux) for frequent, cross-tree updates |
| Custom hooks   | `use` prefix, one concern per hook, return a small stable shape                                                                                                |
| Typing         | TypeScript, explicit prop interfaces, no `any`, discriminated unions for status-like state                                                                     |
| File naming    | Component files: `PascalCase.tsx`; hooks/utils: `camelCase.ts`                                                                                                 |
| Testing        | Vitest + React Testing Library for units, Playwright + `@axe-core/playwright` for e2e/a11y, Lighthouse CI against a real production build                      |

## Reference files

| File                                         | Covers                                                                                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `references/accessibility.md`                | Focus management with refs, `useId()`-based label/aria associations, accessible Button/Modal/Form/Nav in React, headless primitives (Radix UI/React Aria), `eslint-plugin-jsx-a11y`                     |
| `references/performance.md`                  | `React.lazy`/`Suspense`, `useMemo`/`useCallback`/`React.memo` trade-offs, avoiding new-reference props, list virtualization, manual image best practices, Vite bundle analysis, React DevTools Profiler |
| `references/component-and-code-standards.md` | Folder structure, component/hook file naming, hook conventions, TypeScript typing, state-management decision guide, anti-patterns                                                                       |
| `references/testing-and-tooling.md`          | ESLint (`eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`) + Prettier, Vitest + RTL, Playwright + axe, Lighthouse CI against a production build                              |

The full framework-agnostic baseline lives in the companion `core-standards` skill — install both together; this skill layers React-specific APIs and conventions on top.

## Generating the project rule file

`assets/RULES.md` is self-contained and ready to drop into `CLAUDE.md`, `.cursor/rules/react-frontend-standards.mdc`, or `AGENTS.md` — or run `npx frontend-standard-skills add react`.

## Good vs. bad, at a glance

**Bad — new object/function literals defeat memoization, no code-splitting, unmanaged image dimensions:**

```tsx
function ProductPage({ product }) {
  return (
    <div>
      <img src={product.image} />
      <ExpensiveGallery
        images={product.images}
        options={{ autoplay: true }} // new object every render
        onSelect={(id) => selectImage(id)} // new function every render
      />
    </div>
  );
}
```

**Good — stable references, explicit image sizing, split out the heavy part:**

```tsx
import { lazy, Suspense, useCallback, useMemo } from 'react';

const ExpensiveGallery = lazy(() => import('./ExpensiveGallery'));
const GALLERY_OPTIONS = { autoplay: true }; // module-level, stable reference

function ProductPage({ product }: { product: Product }) {
  const handleSelect = useCallback((id: string) => selectImage(id), []);
  const images = useMemo(() => product.images, [product.images]);

  return (
    <article>
      <img
        src={product.image}
        alt={`${product.name} product photo`}
        width={800}
        height={600}
      />
      <Suspense fallback={<GallerySkeleton />}>
        <ExpensiveGallery
          images={images}
          options={GALLERY_OPTIONS}
          onSelect={handleSelect}
        />
      </Suspense>
    </article>
  );
}
```

## Library reference

![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![WCAG 2.1 AA](https://img.shields.io/badge/WCAG-2.1%20AA-2E7D32?style=for-the-badge)

- Docs: [react.dev](https://react.dev)
- API reference: [react.dev/reference/react](https://react.dev/reference/react)
- Source: [github.com/facebook/react](https://github.com/facebook/react)

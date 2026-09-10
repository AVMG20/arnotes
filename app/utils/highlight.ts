import { createLowlight, common } from 'lowlight'
import type { LanguageFn } from 'highlight.js'

// Lowlight falls back to auto-detection for a language it does not know, and
// `chart` and `mermaid` source reads as YAML or nothing in particular to it.
// Each gets a grammar of its own instead, small enough to keep here.

const chart: LanguageFn = hljs => ({
  name: 'chart',
  case_insensitive: true,
  contains: [
    hljs.HASH_COMMENT_MODE,
    { scope: 'attr', begin: /^\s*[^:\n]+(?=\s*:)/ },
    { scope: 'number', begin: /[-+]?\d[\d.]*(?:e[-+]?\d+)?/ }
  ]
})

const mermaid: LanguageFn = hljs => ({
  name: 'mermaid',
  keywords: {
    keyword: 'flowchart graph sequenceDiagram classDiagram stateDiagram stateDiagram-v2 erDiagram gantt pie journey '
      + 'gitGraph mindmap timeline quadrantChart requirementDiagram xychart-beta block-beta sankey-beta '
      + 'subgraph end participant actor activate deactivate loop alt else opt par and critical break rect note '
      + 'over left right of class state section title dateFormat axisFormat direction TB TD BT LR RL '
      + 'style classDef click linkStyle showData',
    literal: 'true false'
  },
  contains: [
    hljs.COMMENT(/%%/, /$/),
    hljs.QUOTE_STRING_MODE,
    { scope: 'string', begin: /\|/, end: /\|/ },
    { scope: 'operator', begin: /-->|---|-\.->|==>|<-->|--|->>|-->>|->|<-|\.\.>|==|:::/ },
    { scope: 'punctuation', begin: /[[\]{}()]/ },
    { scope: 'number', begin: /\b\d+(?:\.\d+)?\b/ }
  ]
})

/** The highlighter every editor uses, with the diagram languages registered. */
export function createEditorLowlight() {
  const lowlight = createLowlight(common)
  lowlight.register({ chart, mermaid })
  return lowlight
}

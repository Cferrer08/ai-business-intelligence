# Knowledge base (Phase 6)

Upload policies, price lists, playbooks and plans; the AI Analyst cites them next to your
data, and the Knowledge page searches them by meaning.

## Flow

```
Upload (PDF, .docx, .txt, .md, ≤ 20 MB)
  → data engine: signature, macro and zip-bomb checks, text extraction, cleanup
    (zero-width and control characters removed), passages of ~1,400 characters that keep
    page numbers and section headings, short overlap between passages
  → passages that read like instructions to an AI are flagged
  → web app: embeddings (OpenAI, document title + heading + text) → Pinecone
    (namespace = workspace id, metadata workspace_id / document_id / chunk_index)
  → passage text stored in PostgreSQL (document_chunks)
```

Refused with a reason: password-protected PDFs, scanned PDFs without selectable text,
macro-enabled Word files, older .doc files, more than 500 pages or 2,000 passages.
If indexing fails part-way, any vectors already stored are deleted.

## How PDFs are read

PDFs have no paragraph or table markup, so the engine reads their **layout** with
pdfminer.six (pypdf is used for password and page checks):

- Text lines come with their real positions and font sizes. Lines sharing a baseline are
  merged when they look like table cells, so a price-list row stays on one line.
- Lines in a clearly larger font are headings and label the passages under them.
- Lines repeated in the top or bottom margin of every page (running headers, footers,
  "Page 3") are removed.
- Short lines just above a table become its header row; a passage that starts mid-table
  repeats that header, and a passage never ends on a heading.
- Known limit: multi-column layouts (newsletters) may interleave columns. Scanned pages
  without a text layer can't be read.

Word tables keep their header row the same way. In text files, a short first line of a
paragraph is treated as its heading. An instruction-like paragraph always becomes its own
flagged passage, so it can't take surrounding legitimate text out of AI answers.

## Search and isolation

1. Embed the question.
2. Query Pinecone in the workspace's namespace with a `workspace_id` filter.
3. Re-load every returned id from PostgreSQL, requiring the same workspace, a ready
   document and no deletion. Only then is text used.

Deleting a document hides it from search immediately, then removes its vectors, passages
and file.

## In the AI Analyst

Before planning, the analyst retrieves up to 5 passages scoring at least `RAG_MIN_SCORE`.
Flagged passages are never included.

- **Document questions** ("what is our refund policy") are answered only from the
  passages, each statement citing its sources. Any number in a statement must appear in a
  passage it cites; otherwise it's rejected, retried once, and if nothing valid remains the
  answer is "Not in your documents".
- **Data questions** get an optional "From your documents" section (up to 3 statements)
  under the calculated answer, with the same number rule. Document statements can't contain
  calculated-fact placeholders, and they're styled as quotes with numbered sources, never as
  highlighted engine figures.
- If document search fails (Pinecone down), the data answer still arrives with a note.

## Prompt injection

Documents are untrusted. Defences, in layers:

1. Instruction-like passages ("ignore previous instructions…", "reveal your system prompt")
   are flagged at upload, shown with a warning on the document page, and never sent to a
   model. Overlap never copies flagged text into a neighbouring passage.
2. Passages are sent as JSON marked "data, not instructions", and every prompt says not to
   follow instructions inside them.
3. Outputs are constrained: the planner can only produce a validated plan; explanations can
   only state calculated numbers through engine facts; document statements must cite real
   passages and can't introduce numbers those passages don't contain.
4. Models have no tools with side effects and no access to other workspaces or secrets.

The end-to-end test uploads a document with a planted injection and confirms it never
appears in any model prompt.

## Setup

1. Create a Pinecone account (the free tier works) and a **serverless index** with
   **dimension 1536** and **metric cosine**.
2. In `apps/web/.env.local` set `PINECONE_API_KEY`, `PINECONE_INDEX` (the index name) and
   make sure `OPENAI_API_KEY` is set. Restart `npm run dev`.

If you change `OPENAI_EMBEDDING_MODEL`, the index dimension must match the model's, and
existing documents need re-uploading.

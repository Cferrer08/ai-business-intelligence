"use client";

import { Uploader } from "@/components/data/Uploader";
import { checkDocument, DOC_ACCEPT, MAX_DOC_MB } from "@/lib/knowledge/rules";

export function KnowledgeUploader() {
  return (
    <Uploader config={{
      endpoint: "/api/documents", accept: DOC_ACCEPT, check: checkDocument,
      hint: `PDF, Word (.docx) or text (.txt, .md), up to ${MAX_DOC_MB} MB. Policies, price lists, playbooks, plans.`,
      redirect: (id) => `/knowledge/${id}`, processingText: "Reading the document and indexing every passage…", label: "Upload a document",
    }} />
  );
}

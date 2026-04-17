# AI-Based Tender Evaluation and Eligibility Analysis for Government Procurement (CRPF)

**Team / product name:** TenderSense AI  
**Round:** 1 — Written solution  
**Date:** 18 April 2026  

---

## 1. Problem understanding (government procurement realities)

Government tenders encode eligibility as **legal language** spread across long documents. Bidders respond with **heterogeneous evidence**: typed PDFs, scans, tables, and photos. The surface task is “extract → match → decide,” but production systems must solve four coupled problems:

1. **Document normalization** — layout, scans, mixed Hindi/English labels, and inconsistent number formats (Indian grouping, ₹/Rs./INR, Crore/Lakh).
2. **Semantic interpretation** — phrases such as “not less than,” “any one of the last three financial years,” and “similar works” are not keyword rules; they require structured interpretation and traceable assumptions.
3. **Multi-source consistency** — the same fact (e.g., turnover) may appear on a P&L, tax filing, and CA certificate with **different numbers**; silent picking is unacceptable in procurement.
4. **Trust propagation** — OCR noise, extraction uncertainty, and semantic ambiguity must **lower confidence** and route to **human review** rather than silently rejecting a bidder.

Failure modes judges care about: **false disqualification** from bad OCR, **unauditable** decisions, and **inconsistent** application of rules across bidders. Our design prioritizes **explainability and auditability** alongside accuracy, because procurement failures are often **accountability** failures.

---

## 2. Extracting eligibility criteria from the tender

**Approach**

- **Ingestion:** Store the tender PDF in an object store; extract text with **native PDF parsing first** (digital text), falling back to **OCR** for scans (PaddleOCR primary, Tesseract fallback), with a **document quality score** per file.
- **Segmentation:** Run a structured extraction pass (LLM with schema validation when available; deterministic fallback for sandbox demos) that classifies clauses into:
  - **Financial** (turnover, net worth, liquidity),
  - **Technical / experience** (similar projects, timelines),
  - **Compliance** (certifications, registrations, undertakings),
  - **Documentary** (mandatory annexures).
- **Mandatory vs optional:** Each criterion carries `mandatory: true|false` and `depends_on` for conditional requirements.
- **Machine-usable form:** Criteria are stored as **JSON** (field identifier, operator, threshold, unit, temporal window, `source_priority` for evidence types). This avoids hardcoded `if` chains and supports **scalability** across tenders.

**Why not keyword-only extraction?** Legal phrasing varies; we combine **LLM structured extraction** with **validator rules** (numeric normalization, unit checks) to reduce hallucination and ensure every stored criterion is **typed and testable**.

---

## 3. Parsing bidder submissions (heterogeneous formats)

**Pipeline**

1. **Classify** each file (financial, GST, ISO, experience, generic supporting).
2. **Extract text:** pdfplumber for text PDFs; OCR pipeline for scans/images with layout-friendly OCR where available.
3. **Field mapping:** Map extracted spans to criterion `field` keys using:
   - Regex/normalization for numbers, dates, GSTIN patterns,
   - LLM-assisted span linking when the field is narrative (with confidence).
4. **Evidence objects:** Every extracted value becomes an **evidence record** with `document_id`, page, optional bounding box, raw text, **normalized value**, and **OCR confidence**.

**Variation across bidders** is handled by **normalization** (currency, units) and **source priority** (e.g., CA certificate preferred over unaudited statements when both exist).

---

## 4. Matching extracted data to criteria (ambiguity and partial information)

**Operators and thresholds:** Compare normalized values using declared operators (`>=`, `==`, etc.) against criterion thresholds in a **single rule engine** (data-driven JSON), not ad-hoc code per tender.

**Ambiguity (three classes)**

1. **Extraction ambiguity** — low OCR confidence or weak parse of a number.
2. **Semantic ambiguity** — multiple defensible interpretations of the clause (`semantic_ambiguity_score`).
3. **Conflict ambiguity** — same field, **inconsistent values** across documents beyond tolerance.

**Policy:** The system **never silently disqualifies** on uncertain inputs. Conditions such as overall confidence below threshold, conflict detected, or missing mandatory evidence yield **`NEEDS_REVIEW`** with explicit reasons, not a hidden fail.

**Cross-document validation:** A second pass compares values for the same factual field across all uploaded sources; material divergence triggers review and surfaces in the UI.

---

## 5. Explainable verdicts and human-in-the-loop

**Per-criterion output**

- Verdict: `ELIGIBLE`, `NOT_ELIGIBLE`, or `NEEDS_REVIEW`.
- **Reasoning string** referencing criterion, operator, threshold, chosen evidence, and confidence.
- **Evidence chain:** document name, page, snippet, normalized value.

**Reasoning graph (UI)** — A directed structure linking **criterion nodes** to **verdict nodes** with confidence, making the evaluation legible to non-ML stakeholders.

**HITL triggers (examples)** — Low confidence, OCR failure on critical fields, cross-document conflict, high semantic ambiguity, or missing mandatory documents.

**Reviewer workflow** — Present source image/PDF context, extracted value, and rationale; actions: **accept** or **override with written justification**. Overrides feed audit logs and can adjust calibration thresholds over time (lightweight feedback loop, not full model retraining in Round 2 scope).

---

## 6. Auditability for formal procurement

**Immutable audit trail**

- Append-only events: upload, OCR run, criterion evaluation, review decision, override.
- Each automated decision record includes an **evidence snapshot** and a **cryptographic checksum** over the canonical payload (tamper-evident).

This supports questions procurement officers ask in practice: *who decided what, on what evidence, and can we prove it later?*

---

## 7. Architecture overview and technology choices

**High level**

- **API gateway / backend:** Go (Gin) for concurrent request handling and orchestration.
- **AI worker:** Python (FastAPI) for OCR stack, extraction, and decision engine (callable from Go over HTTP).
- **Storage:** PostgreSQL (structured entities, criteria JSON, decisions, audit), object storage for files (MinIO/S3-compatible in production).
- **Async:** Design assumes event bus (Kafka) in production; hackathon / MVP can use simpler queuing (e.g., Redis Streams) with the same logical events.

**Models**

- **OCR:** PaddleOCR for Indian documents and layout-heavy scans; Tesseract fallback.
- **Criteria extraction:** Claude API (or equivalent) with **strict JSON schema** when keys exist; deterministic fallback for offline demos.
- **Embeddings / search:** pgvector optional for semantic similarity of legal clauses; not required for baseline eligibility if criteria are extracted explicitly.

**Rationale:** Go for operational simplicity and performance at the edge; Python for ML/OCR ecosystem; one **explainable** decision layer with explicit confidence math rather than opaque end-to-end classification.

---

## 8. Risks and trade-offs

| Risk | Mitigation |
|------|------------|
| OCR errors on poor scans | Quality scoring; dual OCR engines; route low confidence to review |
| LLM hallucination on criteria | Schema validation, human review of extracted criteria list, deterministic fallbacks in sandbox |
| Over-automation bias | Explicit `NEEDS_REVIEW` policy; overrides logged |
| Data sovereignty | On-prem object storage, network controls, audit logs |
| Scope creep in 48h build | Freeze **three golden documents** for live demo; generalize later |

**Trade-off:** A system with **85% automation with full audit** may be more deployable than **95% accuracy with no provenance** — we optimize for defensible decisions.

---

## 9. Round 2 implementation plan (sandbox documents)

**Week 0–1 (foundation)**

- Harden ingest + OCR metrics; store bounding boxes for UI highlighting.
- Wire evaluation jobs idempotently; persist full reasoning graph JSON.

**Week 2 (evaluation depth)**

- Expand cross-document matrix (all financial fields required by tender).
- Add Hindi label handling in OCR path where applicable.

**Week 3 (officer UX + audit)**

- Evidence viewer with highlights; export pack (PDF/CSV) for committee records.
- Pen-test checklist for auth, RBAC, and log integrity.

**Exit criteria for sandbox**

- End-to-end run on provided tender + N bidders with **100% traceability** for automated decisions and **documented** human overrides.

---

## 10. Mapping to evaluation rubric (self-assessment)

| Criterion | How we address it |
|-----------|---------------------|
| Problem understanding | Sections 1, 8 — procurement + failure modes |
| Technical soundness | Sections 2–5, 7 — extraction, matching, explainability |
| Edge cases | OCR, ambiguity classes, conflicts, partial docs |
| HITL + audit | Sections 5–6 |
| Architecture + tech choices | Section 7 |
| Risks / trade-offs | Section 8 |
| Round 2 plan | Section 9 |

---

## 11. Demo narrative (2 minutes)

1. Upload **tender** PDF — show extracted criteria list.  
2. Upload **bidder A** — show eligible path with evidence-backed verdicts.  
3. Upload **bidder B** — show **conflict** → `NEEDS_REVIEW` with explicit reason.  
4. Show **reasoning graph** + **audit** entry / checksum for an override.  

**Pitch line:** *Government tender evaluation today produces outcomes that cannot be explained and cannot be audited. TenderSense AI does not only automate the decision — it automates the justification.*

---

*Appendix: runnable codebase and demo PDFs are provided in the repository (`demo/` folder).*

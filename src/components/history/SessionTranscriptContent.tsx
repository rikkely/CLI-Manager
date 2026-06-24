import { useMemo } from "react";
import { HistoryMarkdownContent } from "./HistoryMarkdownContent";
import {
  isGitStatusLine,
  renderTranscriptHighlights,
  renderTranscriptLineHighlights,
} from "./sessionTranscriptHighlighter";

interface SessionTranscriptContentProps {
  content: string;
  query?: string;
}

type TranscriptSectionKind = "markdown" | "xml" | "workflow-state" | "git" | "list";

interface TranscriptSection {
  id: string;
  kind: TranscriptSectionKind;
  text: string;
  tag?: string;
  status?: string;
}

const XML_BLOCK_TAGS = new Set(["session-context", "current-state", "workflow", "system-reminder", "codex_internal_context"]);
const LONG_BLOCK_LINE_THRESHOLD = 12;
const LONG_BLOCK_CHAR_THRESHOLD = 1_200;
const LONG_LIST_LINE_THRESHOLD = 10;
const PREVIEW_LINE_COUNT = 6;

function normalizeLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

function makeSection(kind: TranscriptSectionKind, text: string, index: number, extra: Partial<TranscriptSection> = {}): TranscriptSection {
  return { id: `${kind}-${index}`, kind, text, ...extra };
}

function isKnownXmlTag(tag: string): boolean {
  return XML_BLOCK_TAGS.has(tag.toLowerCase());
}

function parseXmlInline(line: string): { tag: string; body: string } | null {
  const match = /^\s*<([A-Za-z][\w-]*)(?:\s[^>]*)?>(.*)<\/\1>\s*$/.exec(line);
  if (!match || !isKnownXmlTag(match[1])) return null;
  return { tag: match[1].toLowerCase(), body: match[2] };
}

function parseXmlStart(line: string): string | null {
  const match = /^\s*<([A-Za-z][\w-]*)(?:\s[^>]*)?>\s*$/.exec(line);
  if (!match || !isKnownXmlTag(match[1])) return null;
  return match[1].toLowerCase();
}

function isXmlEnd(line: string, tag: string): boolean {
  return line.trim().toLowerCase() === `</${tag}>`;
}

function parseWorkflowStateStart(line: string): string | null {
  const match = /^\s*\[workflow-state:([A-Za-z0-9_-]+)]\s*$/.exec(line);
  return match?.[1] ?? null;
}

function isWorkflowStateEnd(line: string, status: string): boolean {
  const trimmed = line.trim();
  return trimmed === `[/workflow-state:${status}]` || trimmed === "[/workflow-state]";
}

function isListLine(line: string): boolean {
  return /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d{1,3}[.)]\s+)/.test(line);
}

function getFencePrefix(line: string): string | null {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("```")) return "```";
  if (trimmed.startsWith("~~~")) return "~~~";
  return null;
}

function parseTranscriptSections(content: string): TranscriptSection[] {
  const lines = normalizeLines(content);
  const sections: TranscriptSection[] = [];
  let pending: string[] = [];
  let lineIndex = 0;

  const flushMarkdown = () => {
    const text = trimBlankEdges(pending).join("\n");
    pending = [];
    if (text) sections.push(makeSection("markdown", text, sections.length));
  };

  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    const fencePrefix = getFencePrefix(line);
    if (fencePrefix) {
      pending.push(line);
      lineIndex += 1;
      while (lineIndex < lines.length) {
        pending.push(lines[lineIndex]);
        if (lines[lineIndex].trimStart().startsWith(fencePrefix)) {
          lineIndex += 1;
          break;
        }
        lineIndex += 1;
      }
      continue;
    }

    const inlineXml = parseXmlInline(line);
    if (inlineXml) {
      flushMarkdown();
      sections.push(makeSection("xml", inlineXml.body, sections.length, { tag: inlineXml.tag }));
      lineIndex += 1;
      continue;
    }

    const xmlTag = parseXmlStart(line);
    if (xmlTag) {
      flushMarkdown();
      lineIndex += 1;
      const body: string[] = [];
      while (lineIndex < lines.length && !isXmlEnd(lines[lineIndex], xmlTag)) {
        body.push(lines[lineIndex]);
        lineIndex += 1;
      }
      if (lineIndex < lines.length) lineIndex += 1;
      sections.push(makeSection("xml", trimBlankEdges(body).join("\n"), sections.length, { tag: xmlTag }));
      continue;
    }

    const workflowStatus = parseWorkflowStateStart(line);
    if (workflowStatus) {
      flushMarkdown();
      lineIndex += 1;
      const body: string[] = [];
      while (lineIndex < lines.length && !isWorkflowStateEnd(lines[lineIndex], workflowStatus)) {
        body.push(lines[lineIndex]);
        lineIndex += 1;
      }
      if (lineIndex < lines.length) lineIndex += 1;
      sections.push(
        makeSection("workflow-state", trimBlankEdges(body).join("\n"), sections.length, { status: workflowStatus })
      );
      continue;
    }

    if (isGitStatusLine(line)) {
      flushMarkdown();
      const body: string[] = [];
      while (lineIndex < lines.length && isGitStatusLine(lines[lineIndex])) {
        body.push(lines[lineIndex]);
        lineIndex += 1;
      }
      sections.push(makeSection("git", body.join("\n"), sections.length));
      continue;
    }

    if (isListLine(line)) {
      const body: string[] = [];
      while (lineIndex < lines.length && isListLine(lines[lineIndex])) {
        body.push(lines[lineIndex]);
        lineIndex += 1;
      }
      if (body.length >= LONG_LIST_LINE_THRESHOLD) {
        flushMarkdown();
        sections.push(makeSection("list", body.join("\n"), sections.length));
      } else {
        pending.push(...body);
      }
      continue;
    }

    pending.push(line);
    lineIndex += 1;
  }

  flushMarkdown();
  return sections.length > 0 ? sections : [makeSection("markdown", content, 0)];
}

function getBlockTitle(section: TranscriptSection): string {
  if (section.kind === "workflow-state") return `[workflow-state:${section.status ?? "unknown"}]`;
  if (section.kind === "git") return "Git changes";
  if (section.kind === "list") return "Long task list";
  return `<${section.tag ?? "transcript"}>`;
}

function getBlockKind(section: TranscriptSection): string {
  if (section.kind === "xml") return section.tag ?? "xml";
  return section.kind;
}

function shouldCollapse(section: TranscriptSection, lines: string[]): boolean {
  if (section.kind === "list") return lines.length >= LONG_LIST_LINE_THRESHOLD;
  if (section.kind === "workflow-state") return true;
  if (section.kind === "xml" && section.tag && XML_BLOCK_TAGS.has(section.tag)) {
    return lines.length > PREVIEW_LINE_COUNT || section.text.length >= LONG_BLOCK_CHAR_THRESHOLD;
  }
  if (section.kind === "xml") {
    return lines.length >= LONG_BLOCK_LINE_THRESHOLD || section.text.length >= LONG_BLOCK_CHAR_THRESHOLD;
  }
  return false;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hiddenLinesContainQuery(lines: string[], query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  const matcher = new RegExp(escapeRegExp(trimmed), "i");
  return lines.some((line) => matcher.test(line));
}

function TranscriptLines({ lines, query, sectionId }: { lines: string[]; query: string; sectionId: string }) {
  return (
    <div className="ui-history-transcript-lines">
      {lines.map((line, index) => (
        <div key={`${sectionId}-line-${index}`} className="ui-history-transcript-line">
          {renderTranscriptLineHighlights(line, query, `${sectionId}-line-${index}`)}
        </div>
      ))}
    </div>
  );
}

function TranscriptBlock({ section, query }: { section: TranscriptSection; query: string }) {
  const lines = normalizeLines(section.text);
  const collapsible = shouldCollapse(section, lines);
  const previewLines = collapsible ? lines.slice(0, PREVIEW_LINE_COUNT) : lines;
  const hiddenLines = collapsible ? lines.slice(PREVIEW_LINE_COUNT) : [];
  const title = getBlockTitle(section);

  return (
    <section className="ui-history-transcript-block" data-kind={getBlockKind(section)}>
      <div className="ui-history-transcript-block-header">
        <span className="ui-history-transcript-block-title">{renderTranscriptHighlights(title, query, `${section.id}-title`)}</span>
        {section.status && (
          <span className="ui-history-transcript-token ui-history-transcript-status" data-status={section.status.toLowerCase()}>
            {section.status}
          </span>
        )}
        <span className="ui-history-transcript-block-meta">{lines.length} 行</span>
      </div>
      <TranscriptLines lines={previewLines} query={query} sectionId={`${section.id}-preview`} />
      {hiddenLines.length > 0 && (
        <details className="ui-history-transcript-collapse" open={hiddenLinesContainQuery(hiddenLines, query) || undefined}>
          <summary>展开剩余 {hiddenLines.length} 行</summary>
          <TranscriptLines lines={hiddenLines} query={query} sectionId={`${section.id}-hidden`} />
        </details>
      )}
    </section>
  );
}

export function SessionTranscriptContent({ content, query = "" }: SessionTranscriptContentProps) {
  const sections = useMemo(() => parseTranscriptSections(content), [content]);

  if (sections.length === 1 && sections[0].kind === "markdown") {
    return <HistoryMarkdownContent content={sections[0].text} query={query} />;
  }

  return (
    <div className="ui-history-transcript">
      {sections.map((section) => {
        if (section.kind === "markdown") {
          return <HistoryMarkdownContent key={section.id} content={section.text} query={query} />;
        }
        return <TranscriptBlock key={section.id} section={section} query={query} />;
      })}
    </div>
  );
}

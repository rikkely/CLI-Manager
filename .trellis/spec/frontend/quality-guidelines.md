# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

### Don't allocate per item in hot UI scans

**Problem**:
```typescript
for (const message of messages) {
  if (message.content.toLowerCase().includes(query)) {
    // match
  }
}
```

**Why it's bad**: large terminal/history content can make per-message full-string copies dominate CPU and memory.

**Instead**:
```typescript
const matcher = new RegExp(escapeRegExp(query), "i");
for (const message of messages) {
  if (matcher.test(message.content)) {
    // match
  }
}
```

---

## Required Patterns

### Bound buffers for hidden terminal output

**What**: when terminal output is buffered while a tab is hidden, keep a fixed-size latest suffix instead of an unbounded list.

**Why**: inactive terminal sessions can receive large output bursts while hidden; unbounded buffering makes memory grow with output volume.

**Example**:
```typescript
if (text.length >= maxBufferBytes) {
  buffer = [text.slice(-maxBufferBytes)];
} else {
  buffer.push(text);
  trimOldestUntilWithinLimit();
}
```

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)

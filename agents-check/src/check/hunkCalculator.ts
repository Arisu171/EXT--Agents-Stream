
import { diffArrays } from 'diff';

export interface Hunk {
  id: string;
  groupId: string;
  modifiedStart: number;
  originalStart: number;
  removedLines: RemovedLine[];
  addedLines: AddedLine[];
}

export interface RemovedLine {
  text: string;
  originalLineIndex: number;
}

export interface AddedLine {
  text: string;
  modifiedLineIndex: number;
}

type DiffOp =
  | { type: 'equal'; text: string; origIdx: number; modIdx: number }
  | { type: 'delete'; text: string; origIdx: number }
  | { type: 'insert'; text: string; modIdx: number };

function computeLineDiff(origLines: string[], modLines: string[]): DiffOp[] {
  const changes = diffArrays(origLines, modLines);
  const ops: DiffOp[] = [];
  let origIdx = 0; 
  let modIdx = 0;  

  for (const change of changes) {
    const { value, added, removed } = change;

    if (added) {
      for (let k = 0; k < value.length; k++) {
        ops.push({ type: 'insert', text: value[k]!, modIdx: modIdx + k });
      }
      modIdx += value.length;
    } else if (removed) {
      for (let k = 0; k < value.length; k++) {
        ops.push({ type: 'delete', text: value[k]!, origIdx: origIdx + k });
      }
      origIdx += value.length;
    } else {
      for (let k = 0; k < value.length; k++) {
        ops.push({
          type: 'equal',
          text: value[k]!,
          origIdx: origIdx + k,
          modIdx: modIdx + k,
        });
      }
      origIdx += value.length;
      modIdx += value.length;
    }
  }

  return ops;
}

let hunkCounter = 0;

function makeHunkId(): string {
  return `hunk-${++hunkCounter}-${Date.now()}`;
}

export function calculateHunks(
  originalContent: string,
  modifiedContent: string
): Hunk[] {
  const origLines = originalContent.split(/\r?\n/);
  const modLines = modifiedContent.split(/\r?\n/);

  const lastOrig = origLines.length - 1;
  const lastMod = modLines.length - 1;
  if (lastOrig >= 0 && lastMod >= 0 && origLines[lastOrig] === '' && modLines[lastMod] === '') {
    origLines.pop();
    modLines.pop();
  }

  const ops = computeLineDiff(origLines, modLines);

  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;

  for (const op of ops) {
    if (op.type === 'equal') {
      if (currentHunk) {
        hunks.push(currentHunk);
        currentHunk = null;
      }
    } else if (op.type === 'delete') {
      if (!currentHunk) {
        const id = makeHunkId();
        currentHunk = {
          id,
          groupId: id,
          modifiedStart: 0,
          originalStart: op.origIdx,
          removedLines: [],
          addedLines: [],
        };
      }
      if (currentHunk.removedLines.length === 0) {
        currentHunk.originalStart = op.origIdx;
      }
      currentHunk.removedLines.push({
        text: op.text,
        originalLineIndex: op.origIdx,
      });
    } else if (op.type === 'insert') {
      if (!currentHunk) {
        const id = makeHunkId();
        currentHunk = {
          id,
          groupId: id,
          modifiedStart: op.modIdx,
          originalStart: 0,
          removedLines: [],
          addedLines: [],
        };
      }
      if (currentHunk.addedLines.length === 0) {
        currentHunk.modifiedStart = op.modIdx;
      }
      currentHunk.addedLines.push({
        text: op.text,
        modifiedLineIndex: op.modIdx,
      });
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  let origOffset = 0;
  for (const hunk of hunks) {
    if (hunk.addedLines.length === 0 && hunk.removedLines.length > 0) {
      const firstOrigIdx = hunk.removedLines[0]!.originalLineIndex;
      hunk.modifiedStart = Math.max(0, firstOrigIdx + origOffset);
    }
    origOffset += hunk.addedLines.length - hunk.removedLines.length;
  }

  let modOffset = 0;
  for (const hunk of hunks) {
    if (hunk.removedLines.length === 0 && hunk.addedLines.length > 0) {
      const firstModIdx = hunk.addedLines[0]!.modifiedLineIndex;
      hunk.originalStart = Math.max(0, firstModIdx + modOffset);
    }
    modOffset += hunk.removedLines.length - hunk.addedLines.length;
  }

  return hunks.flatMap(splitAlignedLines);
}

const LINE_PAIR_THRESHOLD = 0.35;

function lineSimilarity(a: string, b: string): number {
  if (a === b) { return 1; }
  const max = a.length > b.length ? a.length : b.length;
  if (max === 0) { return 1; }
  const min = a.length < b.length ? a.length : b.length;

  let prefix = 0;
  while (prefix < min && a.charCodeAt(prefix) === b.charCodeAt(prefix)) { prefix++; }

  let suffix = 0;
  while (
    suffix < min - prefix &&
    a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)
  ) {
    suffix++;
  }

  return (prefix + suffix) / max;
}

function splitAlignedLines(hunk: Hunk): Hunk[] {
  const removed = hunk.removedLines;
  const added = hunk.addedLines;

  if (removed.length === 0 || added.length === 0) { return [hunk]; }
  if (removed.length === 1 && added.length === 1) { return [hunk]; }

  if (removed.length === added.length) {
    const out: Hunk[] = [];
    for (let i = 0; i < removed.length; i++) {
      out.push(makeHunk([removed[i]!], [added[i]!], hunk, i + 1, i + 1));
    }
    return out;
  }

  const out: Hunk[] = [];
  let bufRemoved: RemovedLine[] = [];
  let bufAdded: AddedLine[] = [];
  let i = 0;
  let j = 0;

  const flush = (): void => {
    if (bufRemoved.length === 0 && bufAdded.length === 0) { return; }
    out.push(makeHunk(bufRemoved, bufAdded, hunk, i, j));
    bufRemoved = [];
    bufAdded = [];
  };

  while (i < removed.length && j < added.length) {
    if (lineSimilarity(removed[i]!.text, added[j]!.text) >= LINE_PAIR_THRESHOLD) {
      flush();
      i++;
      j++;
      out.push(makeHunk([removed[i - 1]!], [added[j - 1]!], hunk, i, j));
      continue;
    }

    const skipRemoved = i + 1 < removed.length
      ? lineSimilarity(removed[i + 1]!.text, added[j]!.text)
      : -1;
    const skipAdded = j + 1 < added.length
      ? lineSimilarity(removed[i]!.text, added[j + 1]!.text)
      : -1;

    if (skipRemoved >= LINE_PAIR_THRESHOLD && skipRemoved >= skipAdded) {
      bufRemoved.push(removed[i]!);   
      i++;
    } else if (skipAdded >= LINE_PAIR_THRESHOLD) {
      bufAdded.push(added[j]!);       
      j++;
    } else {
      bufRemoved.push(removed[i]!);
      bufAdded.push(added[j]!);
      i++;
      j++;
    }
  }

  while (i < removed.length) { bufRemoved.push(removed[i++]!); }
  while (j < added.length) { bufAdded.push(added[j++]!); }
  flush();

  return out;
}

function makeHunk(
  removedLines: RemovedLine[],
  addedLines: AddedLine[],
  parent: Hunk,
  nextRemovedIdx: number,
  nextAddedIdx: number
): Hunk {
  const parentRemoved = parent.removedLines;
  const parentAdded = parent.addedLines;

  const originalStart = removedLines.length > 0
    ? removedLines[0]!.originalLineIndex
    : nextRemovedIdx < parentRemoved.length
      ? parentRemoved[nextRemovedIdx]!.originalLineIndex
      : parentRemoved.length > 0
        ? parentRemoved[parentRemoved.length - 1]!.originalLineIndex + 1
        : parent.originalStart;

  const modifiedStart = addedLines.length > 0
    ? addedLines[0]!.modifiedLineIndex
    : nextAddedIdx < parentAdded.length
      ? parentAdded[nextAddedIdx]!.modifiedLineIndex
      : parentAdded.length > 0
        ? parentAdded[parentAdded.length - 1]!.modifiedLineIndex + 1
        : parent.modifiedStart;

  return {
    id: makeHunkId(),
    groupId: parent.groupId,
    originalStart,
    modifiedStart,
    removedLines,
    addedLines,
  };
}

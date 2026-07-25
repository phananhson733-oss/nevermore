"use client";

/**
 * Renders the closed Markdown node set from `_markdown.ts` as React elements.
 *
 * There is no `dangerouslySetInnerHTML` here and there is nowhere to put one:
 * the parser emits text, and text becomes children. That is what lets a
 * model-written body be shown as prose without the body being able to inject
 * anything.
 */

import { Fragment, type ReactElement, type ReactNode } from "react";
import {
  parseMarkdown,
  type InlineNode,
  type MarkdownBlock,
} from "./_markdown.ts";

function inlineNodes(nodes: readonly InlineNode[], key: string): ReactNode[] {
  return nodes.map((node, index) => {
    const nodeKey = `${key}-${String(index)}`;
    switch (node.kind) {
      case "code":
        return <code key={nodeKey}>{node.text}</code>;
      case "strong":
        return <strong key={nodeKey}>{node.text}</strong>;
      case "em":
        return <em key={nodeKey}>{node.text}</em>;
      case "link":
        return (
          <a
            key={nodeKey}
            href={node.href}
            rel="noreferrer noopener"
            target="_blank"
          >
            {node.text}
          </a>
        );
      default:
        return <Fragment key={nodeKey}>{node.text}</Fragment>;
    }
  });
}

function renderBlock(
  block: MarkdownBlock,
  key: string,
  tableClassName: string | undefined,
): ReactNode {
  switch (block.kind) {
    case "heading": {
      const children = inlineNodes(block.inline, key);
      // The page already owns h1/h2, so a body heading starts at h3: a draft's
      // own `#` must not outrank the screen it is being read inside.
      if (block.level === 1) return <h3 key={key}>{children}</h3>;
      if (block.level === 2) return <h4 key={key}>{children}</h4>;
      return <h5 key={key}>{children}</h5>;
    }
    case "paragraph":
      return <p key={key}>{inlineNodes(block.inline, key)}</p>;
    case "quote":
      return <blockquote key={key}>{inlineNodes(block.inline, key)}</blockquote>;
    case "code":
      return (
        <pre key={key}>
          <code>{block.text}</code>
        </pre>
      );
    case "rule":
      return <hr key={key} />;
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={`${key}-i-${String(index)}`}>
          {inlineNodes(item, `${key}-i-${String(index)}`)}
        </li>
      ));
      return block.ordered ? (
        <ol key={key}>{items}</ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
    default:
      return (
        // A wide table scrolls inside its own box so the page never does.
        <div key={key} className={tableClassName}>
          <table>
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th key={`${key}-h-${String(index)}`}>
                    {inlineNodes(cell, `${key}-h-${String(index)}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`${key}-r-${String(rowIndex)}`}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`${key}-r-${String(rowIndex)}-${String(cellIndex)}`}
                    >
                      {inlineNodes(
                        cell,
                        `${key}-r-${String(rowIndex)}-${String(cellIndex)}`,
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function MarkdownBlocks({
  markdown,
  tableClassName,
}: {
  readonly markdown: string;
  readonly tableClassName?: string | undefined;
}): ReactElement {
  const blocks = parseMarkdown(markdown);
  return (
    <>
      {blocks.map((block, index) =>
        renderBlock(block, `md-${String(index)}`, tableClassName),
      )}
    </>
  );
}

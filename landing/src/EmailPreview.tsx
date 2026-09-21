import { Fragment } from "react";
import { parseEmailBody } from "./email-preview";
import "./email-preview.css";

type EmailPreviewProps = {
  subject: string | null;
  body: string;
  /** One paragraph to mark as the line written for this recipient. Callers
      that pass nothing render exactly as before. */
  emphasize?: string | null;
};

/** The recipient-facing email, rendered from the same narrow contract sent. */
export function EmailPreview({ subject, body, emphasize }: EmailPreviewProps) {
  const paragraphs = parseEmailBody(body);
  const marked = emphasize?.replace(/\s+/g, " ").trim() || null;

  return (
    <section className="email-preview" aria-label="Email as the recipient will see it">
      {subject && (
        <div className="email-preview-subject">
          <span>Subject</span>
          <strong>{subject}</strong>
        </div>
      )}
      <div className="email-preview-body">
        {paragraphs.map((paragraph, paragraphIndex) => (
          <p
            key={paragraphIndex}
            className={
              marked &&
              paragraph.lines
                .map((line) => (line.kind === "text" ? line.text : ""))
                .join(" ")
                .replace(/\s+/g, " ")
                .trim() === marked
                ? "email-preview-personal"
                : undefined
            }
          >
            {paragraph.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                {line.kind === "text" ? (
                  line.text
                ) : (
                  <a href={line.linkUrl} target="_blank" rel="noopener noreferrer">
                    <img src={line.imageUrl} alt={line.alt} loading="lazy" decoding="async" />
                  </a>
                )}
              </Fragment>
            ))}
          </p>
        ))}
      </div>
    </section>
  );
}

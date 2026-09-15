import { Fragment, type ReactNode } from "react";
import {
  FIELD_LABELS,
  type Clip,
  type ClipField,
  type SceneId,
} from "./studio-model";

export default function ScenePhone({
  clip,
  scene,
  onSelect,
  selectedField,
}: {
  clip: Clip;
  scene: SceneId;
  onSelect?: (field: ClipField) => void;
  selectedField?: ClipField;
}) {
  const edit = (field: ClipField, content: ReactNode, className = "") =>
    onSelect ? (
      <button
        type="button"
        className={`phone-editable ${className} ${selectedField === field ? "is-targeted" : ""}`}
        aria-label={`Edit ${FIELD_LABELS[field].toLowerCase()}`}
        onClick={() => onSelect(field)}
      >
        {content}
        <span className="phone-edit-mark" aria-hidden="true">
          ↗
        </span>
      </button>
    ) : (
      <div className={className}>{content}</div>
    );
  const card = (
    <div className="phone-result-card">
      <div className="phone-landscape" aria-hidden="true">
        <span className="phone-sun" />
        <span className="phone-coast" />
        <span className="phone-building a" />
        <span className="phone-building b" />
        <span className="phone-building c" />
        <span className="phone-landscape-label">{clip.destination}</span>
      </div>
      <div className="phone-result-copy">
        {edit("resultTitle", <strong>{clip.resultTitle}</strong>)}
        <span>{clip.resultDetail}</span>
        <small>{clip.destination} · 2 nights · $420</small>
      </div>
    </div>
  );
  return (
    <div
      className={`scene-phone palette-${clip.palette} background-${clip.background} text-${clip.textSize}`}
    >
      <div className="phone-status" aria-hidden="true">
        <span>9:41</span>
        <span className="phone-island" />
        <span>▮▮▮ ▰</span>
      </div>
      <div className="phone-contact">
        <span aria-hidden="true">‹</span>
        <div className="phone-avatar" aria-hidden="true">
          ↗
        </div>
        <strong>
          Sample Travel<span>your next little escape</span>
        </strong>
        <span aria-hidden="true">⌕</span>
      </div>
      <div className="phone-conversation">
        <span className="phone-date">Today, 9:41 AM</span>
        {scene === "opening" && (
          <>
            <span className="phone-conversation-space" />
            {edit("request", clip.request, "phone-bubble outgoing")}
            <small className="phone-delivered">Delivered</small>
          </>
        )}
        {scene === "reply" && (
          <>
            {edit("request", clip.request, "phone-bubble outgoing")}
            {edit("reply", clip.reply, "phone-bubble incoming")}
            <div className="phone-bubble outgoing">
              Somewhere warm, by the water.
            </div>
          </>
        )}
        {scene === "choices" && (
          <>
            <div className="phone-bubble incoming">
              A little sun, a little sea. Which feels like you?
            </div>
            <div className="phone-poll">
              {(["destination", "optionTwo", "optionThree"] as const).map(
                (field, i) => (
                  <Fragment key={field}>
                    {edit(
                      field,
                      <>
                        <span className="phone-option-dot">
                          {i === 0 ? "●" : "○"}
                        </span>
                        <span>{clip[field]}</span>
                        {i === 0 && <span className="phone-picked">✓</span>}
                      </>,
                      `phone-option ${i === 0 ? "is-picked" : ""}`,
                    )}
                  </Fragment>
                ),
              )}
            </div>
            <div className="phone-bubble incoming">
              {clip.destination} it is. Let me put it together.
            </div>
          </>
        )}
        {scene === "result" && (
          <>
            <div className="phone-bubble incoming">
              A weekend in {clip.destination}, just for you.
            </div>
            {card}
            <span className="phone-heart" aria-label="Heart reaction">
              ♥
            </span>
          </>
        )}
        {scene === "checkout" && (
          <>
            {edit("closing", clip.closing, "phone-bubble incoming")}
            <div className="phone-bubble outgoing">Let’s go!</div>
            <div className="phone-payment">
              <span className="phone-ticket" aria-hidden="true">
                ↗
              </span>
              <strong>A weekend in {clip.destination}</strong>
              <span>Flights + 2 nights · 1 traveler</span>
              <b>
                $420<span>illustrative total</span>
              </b>
              <div className="phone-pay">Pay</div>
            </div>
          </>
        )}
      </div>
      <div className="phone-composer" aria-hidden="true">
        <span>＋</span>
        <div>
          Message<span>↑</span>
        </div>
      </div>
      <span className="phone-home" aria-hidden="true" />
    </div>
  );
}

"use client";

import { useId, useRef } from "react";

export default function FooterLegalButton({ label, title, unavailable, close }: {
  label: string; title: string; unavailable: string; close: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return <>
    <button type="button" className="site-footer__legal-button" onClick={() => dialog.current?.showModal()}>{label}</button>
    <dialog ref={dialog} className="site-footer__dialog" aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      <p>{unavailable}</p>
      <button type="button" className="button button--outline" onClick={() => dialog.current?.close()}>{close}</button>
    </dialog>
  </>;
}

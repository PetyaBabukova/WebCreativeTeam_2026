"use client";

import { useEffect, useRef, useState } from "react";
import { MotionConfig, motion } from "motion/react";

type IntroCopy = {
  lines: string[];
  description: string;
  items: { title: string; proposition: string; description: string }[];
};

const revealEase = [.16, 1, .3, 1] as const;

function IntroIcon({ index }: { index: number }) {
  return <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {index === 0 ? <><path d="M2 20c5-7 11-11 18-11s13 4 18 11c-5 7-11 11-18 11S7 27 2 20Z" /><circle cx="20" cy="20" r="5" /></>
      : index === 1 ? <path d="M20 2c3 11 7 15 18 18-11 3-15 7-18 18-3-11-7-15-18-18C13 17 17 13 20 2Z" />
        : <path d="M3 32 15 19l8 7L37 9M26 9h11v11" />}
  </svg>;
}

export default function IntroSection({ copy }: { copy: IntroCopy }) {
  const sectionRef = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState<"shown" | "pending">("shown");

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof IntersectionObserver === "undefined") return;
    const title = section.querySelector(".intro__title");
    if (!title) return;
    let observer: IntersectionObserver | undefined;
    let frame = 0;
    const prepare = () => {
      // Keep restored or already visible content readable instead of hiding it after hydration.
      if (window.scrollY > 0 || title.getBoundingClientRect().top < window.innerHeight) return;
      setPhase("pending");
      observer = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting) return;
        setPhase("shown");
        observer?.disconnect();
      }, { rootMargin: "0% 0% -20% 0%" });
      observer.observe(title);
    };
    const afterLoad = () => { frame = requestAnimationFrame(() => { frame = requestAnimationFrame(prepare); }); };
    if (document.readyState === "complete") afterLoad();
    else window.addEventListener("load", afterLoad, { once: true });
    return () => {
      window.removeEventListener("load", afterLoad);
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, []);

  const reveal = (delay: number) => ({
    initial: false as const,
    animate: phase === "pending" ? { opacity: 0, y: 32 } : { opacity: 1, y: 0 },
    transition: phase === "pending" ? { duration: 0 } : { duration: .72, delay, ease: revealEase },
  });

  return <MotionConfig reducedMotion="never">
    <section id="intro" ref={sectionRef} className="intro" aria-labelledby="intro-title">
      <div className="container intro__inner">
        <div className="intro__header">
          <motion.h2 id="intro-title" className="intro__title" {...reveal(0)}>
            {copy.lines.map((line, index) => <span className={`intro__title-line intro__title-line--${index}`} key={line}>{line}{index < copy.lines.length - 1 ? " " : null}</span>)}
          </motion.h2>
          <motion.p className="intro__lead" {...reveal(.1)}>{copy.description}</motion.p>
        </div>
        <ul className="intro__cards" role="list">
          {copy.items.map((item, index) => <motion.li className="intro__card" key={item.title} {...reveal(.18 + index * .12)}>
            <span className="intro__marker" aria-hidden="true"><IntroIcon index={index} /></span>
            <h3 className="intro__card-title">{item.title}</h3>
            <p className="intro__card-proposition">{item.proposition}</p>
            <span className="intro__card-rule" aria-hidden="true" />
            <p className="intro__card-description">{item.description}</p>
          </motion.li>)}
        </ul>
      </div>
    </section>
  </MotionConfig>;
}

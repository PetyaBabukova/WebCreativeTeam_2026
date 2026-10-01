"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { MotionConfig, motion, useAnimationFrame, useMotionValue, useScroll, useSpring, useTransform } from "motion/react";
import heroOrb from "@/2026_Redesign/Assets/Hero logo 1.webp";

// Degrees per millisecond: one full turn every 24 seconds.
const rotationSpeed = 360 / 24000;

const entranceEase = [.33, 1, .68, 1] as const;

// The scroll arrow turns from pointing left to pointing down over the first 40% of a viewport height of scroll.
const arrowTurnViewportShare = .4;

type HeroMotionProps = {
  lines: string[];
  description: string;
  rotationPauseLabel: string;
};

export default function HeroMotion({ lines, description, rotationPauseLabel }: HeroMotionProps) {
  return <MotionConfig reducedMotion="never">
    <div className="hero__content">
      <h1 id="hero-title">
        {lines.map((line, index) => <span className="hero__headline-mask" key={line}>
          <motion.span
            className={`hero__headline-line hero__headline-line--${index}`}
            initial={{ opacity: 0, y: "105%" }}
            animate={{ opacity: 1, y: "0%" }}
            transition={{ delay: 1.15 + index * .2, duration: .75, ease: entranceEase }}
          >{line}{index < lines.length - 1 ? " " : null}</motion.span>
        </span>)}
      </h1>
      <HeroOrb rotationPauseLabel={rotationPauseLabel} />
      <motion.div
        className="hero__lede"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.85, duration: .55, ease: entranceEase }}
      >
        <p className="hero__description">{description}</p>
        <ScrollArrow />
      </motion.div>
    </div>
  </MotionConfig>;
}

function ScrollArrow() {
  const { scrollY } = useScroll();
  // The SVG is drawn pointing down-left: +45deg turns it to point left, -45deg to point down.
  const rotate = useTransform(scrollY, (y) => {
    if (typeof window === "undefined") return 45;
    return 45 - 90 * Math.min(1, Math.max(0, y / (window.innerHeight * arrowTurnViewportShare)));
  });

  return <motion.svg className="hero__arrow" viewBox="0 0 100 100" aria-hidden="true" focusable="false" style={{ rotate }}>
    <path d="M84 16 18 82M18 30v52h52" />
  </motion.svg>;
}

function HeroOrb({ rotationPauseLabel }: { rotationPauseLabel: string }) {
  const [inViewport, setInViewport] = useState(true);
  const [hasRisen, setHasRisen] = useState(false);
  const [rotationPaused, setRotationPaused] = useState(false);
  const orbRef = useRef<HTMLDivElement>(null);
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const rotation = useMotionValue(0);
  const rotateX = useSpring(useTransform(pointerY, [-.5, .5], [7, -7]), { stiffness: 100, damping: 18 });
  const rotateY = useSpring(useTransform(pointerX, [-.5, .5], [-7, 7]), { stiffness: 100, damping: 18 });

  useEffect(() => {
    const target = orbRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => setInViewport(entry.isIntersecting), { threshold: .05 });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const shouldRotate = inViewport && hasRisen && !rotationPaused;

  useAnimationFrame((_time, delta) => {
    if (shouldRotate) rotation.set(rotation.get() + Math.min(delta, 100) * rotationSpeed);
  });

  return <div ref={orbRef} className="hero-orb">
    <motion.div
      className="hero-orb__entrance"
      aria-hidden="true"
      initial={{ opacity: 0, y: 110, scale: .55 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        delay: .35,
        opacity: { duration: .25, ease: "linear" },
        y: { duration: 1.25, ease: entranceEase },
        scale: { duration: 1.25, ease: entranceEase },
      }}
      onAnimationComplete={() => setHasRisen(true)}
    >
      <motion.div
        className="hero-orb__tilt"
        style={{ rotateX, rotateY, transformPerspective: 900 }}
        onPointerMove={(event) => {
          if (!inViewport || !hasRisen || event.pointerType !== "mouse") return;
          const bounds = event.currentTarget.getBoundingClientRect();
          pointerX.set((event.clientX - bounds.left) / bounds.width - .5);
          pointerY.set((event.clientY - bounds.top) / bounds.height - .5);
        }}
        onPointerLeave={() => { pointerX.set(0); pointerY.set(0); }}
      >
        <motion.div
          className="hero-orb__spin"
          style={{ rotate: rotation }}
        >
          <Image src={heroOrb} alt="" width={1254} height={1254} priority sizes="(max-width: 760px) min(44vw, 18svh), (max-width: 1440px) 19.2vw, 25.2rem" />
        </motion.div>
      </motion.div>
    </motion.div>
    <button
      className="hero-orb__control"
      type="button"
      aria-label={rotationPauseLabel}
      aria-pressed={rotationPaused}
      onClick={() => setRotationPaused((paused) => !paused)}
    >
      <span className={rotationPaused ? "hero-orb__play-icon" : "hero-orb__pause-icon"} aria-hidden="true" />
    </button>
  </div>;
}

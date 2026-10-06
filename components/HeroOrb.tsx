"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { MotionConfig, motion, useAnimationFrame, useMotionValue, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import heroOrb from "@/assets/hero/orb.webp";

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
      <p className="hero__headline">
        {lines.map((line, index) => <span className="hero__headline-mask" key={line}>
          <motion.span
            className={`hero__headline-line hero__headline-line--${index}`}
            initial={{ opacity: 0, y: "105%" }}
            animate={{ opacity: 1, y: "0%" }}
            transition={{ delay: 1.15 + index * .2, duration: .75, ease: entranceEase }}
          >{line}{index < lines.length - 1 ? " " : null}</motion.span>
        </span>)}
      </p>
      <HeroOrb rotationPauseLabel={rotationPauseLabel} />
      <motion.div
        className="hero__lede"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.85, duration: .55, ease: entranceEase }}
      >
        <h1 id="hero-title" className="hero__description">{description}</h1>
        <HeroScrollArrow />
      </motion.div>
    </div>
  </MotionConfig>;
}

function HeroScrollArrow() {
  const { scrollY } = useScroll();
  const viewportHeight = useMotionValue(900);
  useEffect(() => {
    const update = () => viewportHeight.set(window.innerHeight);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [viewportHeight]);
  // The SVG is drawn pointing down-left: +45deg turns it to point left, -45deg to point down.
  const rotate = useTransform(() => 45 - 90 * Math.min(1, Math.max(0, scrollY.get() / (viewportHeight.get() * arrowTurnViewportShare))));

  return <ScrollArrow className="hero__arrow" rotate={rotate} />;
}

export function ScrollArrow({ className, rotate }: { className: string; rotate: MotionValue<number> }) {
  return <motion.svg className={className} viewBox="0 0 774.96 774.68" aria-hidden="true" focusable="false" style={{ rotate }}>
    <polygon points="0.29,774.68 774.96,774.68 774.96,723.03 85.86,723.03 763.42,45.47 726.91,8.95 51.93,683.93 51.93,0 0.29,0 0.29,735.57 0,735.86 0.29,736.15" />
  </motion.svg>;
}

function HeroOrb({ rotationPauseLabel }: { rotationPauseLabel: string }) {
  const [inViewport, setInViewport] = useState(true);
  const [hasRisen, setHasRisen] = useState(false);
  const [rotationPaused, setRotationPaused] = useState(false);
  const orbRef = useRef<HTMLDivElement>(null);
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const tiltRange = useMotionValue(7);
  const rotation = useMotionValue(0);
  const rotateX = useSpring(useTransform(() => -pointerY.get() * 2 * tiltRange.get()), { stiffness: 100, damping: 18 });
  const rotateY = useSpring(useTransform(() => pointerX.get() * 2 * tiltRange.get()), { stiffness: 100, damping: 18 });

  useEffect(() => { tiltRange.set(rotationPaused ? 17 : 7); }, [rotationPaused, tiltRange]);

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
      onPointerMove={(event) => {
        if (!inViewport || !hasRisen || event.pointerType !== "mouse") return;
        const bounds = event.currentTarget.getBoundingClientRect();
        pointerX.set((event.clientX - bounds.left) / bounds.width - .5);
        pointerY.set((event.clientY - bounds.top) / bounds.height - .5);
      }}
      onPointerLeave={() => { pointerX.set(0); pointerY.set(0); }}
    >
      <motion.div
        className="hero-orb__tilt"
        style={{ rotateX, rotateY, transformPerspective: 900 }}
      >
        <motion.div
          className="hero-orb__spin"
          style={{ rotate: rotation }}
        >
          <Image src={heroOrb} alt="" width={1254} height={1254} priority sizes="(width <= 47.5rem) min(52vw, 23svh), (width <= 128rem) min(17vw, 29svh), 25.2rem" />
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

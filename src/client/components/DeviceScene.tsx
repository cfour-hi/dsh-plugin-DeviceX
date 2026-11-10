/**
 * Pure-CSS 3D device core (decorative; motion pauses off-screen/hidden).
 *
 * The motion toggle lives inside the scene: it is the only control that
 * affects this artwork, so it stays with the artwork instead of the page
 * header. The decorative layers stay `aria-hidden`; the button is real.
 */
import { h } from "../jsx.js";
import { useEffect, useRef, useState } from "../hooks.js";
import { Icon } from "./Icon";

export interface DeviceSceneProps {
  /** Whether the user has 3D motion switched on. */
  active?: boolean;
  /** Tooltip describing the next action ("Pause 3D motion" / "Turn on 3D motion"). */
  toggleLabel?: string;
  /** Accessible name for the toggle. */
  toggleAriaLabel?: string;
  onToggle?: () => void;
}

function ring(layer: number, id: number) {
  return (
    <div className="dx-orbit" data-layer={String(layer)} key={"orbit-" + layer}>
      <div className="dx-ring" data-ring={String(id)} />
    </div>
  );
}

export function DeviceScene(props: DeviceSceneProps) {
  const sceneRef = useRef(null);
  const [inView, setInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);
  useEffect(() => {
    const node = sceneRef.current;
    if (!node || typeof IntersectionObserver !== "function") return void 0;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setInView(entry.isIntersecting === true);
    }, { threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (typeof document === "undefined") return void 0;
    const onChange = () => setPageVisible(document.hidden !== true);
    onChange();
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  const active = props.active !== false;
  const motion = active && inView && pageVisible ? "on" : "off";
  return (
    <div className="dx-scene" data-motion={motion} ref={sceneRef}>
      <div className="dx-sceneArt" aria-hidden="true">
        <div className="dx-sceneGlow" />
        <div className="dx-sceneGrid" />
        {ring(1, 1)}
        {ring(2, 2)}
        {ring(3, 3)}
        <div className="dx-chipScene">
          <div className="dx-chipBody">
            <div className="dx-chipPins">
              {Array.from({ length: 12 }).map((_ignored, index) => (
                <span key={index} />
              ))}
            </div>
            <div className="dx-chipGlow" />
            <div className="dx-chipCore" />
          </div>
        </div>
        {[1, 2, 3, 4].map((particle) => (
          <span key={"particle-" + particle} className="dx-particle" data-p={String(particle)} />
        ))}
        <span className="dx-sceneCaption">DEVICE X</span>
      </div>
      <button
        type="button"
        className="dx-sceneToggle"
        aria-pressed={active}
        aria-label={props.toggleAriaLabel || "3D motion"}
        title={props.toggleLabel}
        onClick={props.onToggle}
      >
        <Icon name="spark" size={12} />
        <span aria-hidden="true">3D</span>
      </button>
    </div>
  );
}

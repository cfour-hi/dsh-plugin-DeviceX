/** Pure-CSS 3D device core (decorative; motion pauses off-screen/hidden). */
import { h } from "../jsx.js";
import { useEffect, useRef, useState } from "../hooks.js";

export interface DeviceSceneProps {
  animated?: boolean;
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
  const motion = props.animated !== false && inView && pageVisible ? "on" : "off";
  return (
    <div className="dx-scene" data-motion={motion} aria-hidden="true" ref={sceneRef}>
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
  );
}

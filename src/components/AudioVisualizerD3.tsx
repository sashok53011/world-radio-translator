import { useEffect, useRef } from "react";
import * as d3 from "d3";

interface AudioVisualizerD3Props {
  analyser: AnalyserNode | null;
  isActive: boolean;
}

export default function AudioVisualizerD3({ analyser, isActive }: AudioVisualizerD3Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = 280;
    const height = 50;
    const numBars = 20;
    const barWidth = width / numBars - 3;

    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const data = Array.from({ length: numBars }, () => 10);

    svg
      .selectAll("rect")
      .data(data)
      .join("rect")
      .attr("x", (d, i) => i * (barWidth + 3))
      .attr("y", (d) => height - d)
      .attr("width", barWidth)
      .attr("height", (d) => d)
      .attr("rx", 3)
      .attr("fill", "#10b981");

    let animationFrameId: number;
    const dataArray = new Uint8Array(numBars);

    const render = () => {
      if (analyser && isActive) {
        analyser.getByteFrequencyData(dataArray);
      } else {
        const time = Date.now() * 0.005;
        for (let i = 0; i < numBars; i++) {
          dataArray[i] = Math.floor(Math.sin(time + i * 0.3) * 15 + 20);
        }
      }

      svg
        .selectAll("rect")
        .data(dataArray)
        .transition()
        .duration(50)
        .ease(d3.easeLinear)
        .attr("y", (d) => {
          const barH = Math.max(6, (d / 255) * height);
          return height - barH;
        })
        .attr("height", (d) => {
          const barH = Math.max(6, (d / 255) * height);
          return barH;
        })
        .attr("fill", (d) => (d > 180 ? "#34d399" : "#10b981"));

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [analyser, isActive]);

  return (
    <div className="flex items-center justify-center p-2 bg-slate-900/40 rounded-xl border border-emerald-500/25 backdrop-blur-sm overflow-hidden shadow-inner">
      <svg ref={svgRef} className="w-full h-[50px] max-w-[280px]" />
    </div>
  );
}

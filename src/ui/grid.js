function laneStepsHtml(laneId, totalSteps, steps, currentStep) {
  const buttons = [];
  for (let step = 0; step < totalSteps; step += 1) {
    const isOn = Boolean(steps[step]);
    const isPlayhead = step === currentStep;
    const beatClass = step % 4 === 0 ? "beat" : "";
    const classes = ["step-btn", isOn ? "on" : "off", isPlayhead ? "playhead" : "", beatClass]
      .filter(Boolean)
      .join(" ");

    buttons.push(
      `<button class="${classes}" data-lane-id="${laneId}" data-step-index="${step}" type="button" aria-label="${laneId} step ${step + 1}">
      </button>`
    );
  }

  return buttons.join("");
}

export function createSequencerGrid(container, { onToggleStep }) {
  container.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (!target.classList.contains("step-btn")) {
      return;
    }

    const laneId = target.dataset.laneId;
    const stepIndex = Number(target.dataset.stepIndex);

    if (!laneId || Number.isNaN(stepIndex)) {
      return;
    }

    onToggleStep(laneId, stepIndex);
  });

  return {
    render({ lanes, totalSteps, pattern, currentStep }) {
      const rows = lanes
        .map((lane) => {
          const lanePattern = pattern[lane.id] || Array.from({ length: totalSteps }, () => false);
          return `<div class="grid-row">
            <div class="grid-lane-label">${lane.label}</div>
            <div class="grid-steps">
              ${laneStepsHtml(lane.id, totalSteps, lanePattern, currentStep)}
            </div>
          </div>`;
        })
        .join("");

      container.innerHTML = `<div class="grid-wrap">${rows}</div>`;
    }
  };
}

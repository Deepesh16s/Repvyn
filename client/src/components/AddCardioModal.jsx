import { useState } from "react";
import {
  CARDIO_ACTIVITY_TYPES,
  CARDIO_METRICS,
  getActivityMetrics,
  getActivityVariants,
} from "../constants/cardioMetadata";
import useModalEscapeAndFocus from "../hooks/useModalEscapeAndFocus";
import "./AddWorkoutModal.css";

function AddCardioModal({ closeModal, onAddCardio }) {
  const [activityType, setActivityType] = useState(CARDIO_ACTIVITY_TYPES[0]);
  const [variant, setVariant] = useState("");
  const [metricValues, setMetricValues] = useState({});
  const [validationMessage, setValidationMessage] = useState("");

  useModalEscapeAndFocus(true, closeModal);

  const { requiredMetrics, optionalMetrics } = getActivityMetrics(activityType);
  const visibleMetrics = [...requiredMetrics, ...optionalMetrics];
  const availableVariants = getActivityVariants(activityType);

  const handleActivityChange = (e) => {
    setActivityType(e.target.value);
    setVariant("");
    setMetricValues({});
    setValidationMessage("");
  };

  const handleMetricChange = (key, value) => {
    setMetricValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setValidationMessage("");

    for (const key of requiredMetrics) {
      const value = metricValues[key];
      if (
        value === undefined ||
        value === "" ||
        isNaN(Number(value)) ||
        Number(value) < 0
      ) {
        const label = CARDIO_METRICS[key]?.label || key;
        setValidationMessage(`${label} is required for ${activityType}`);
        return;
      }
    }

    for (const key of optionalMetrics) {
      const value = metricValues[key];
      if (value === undefined || value === "") continue;
      if (isNaN(Number(value)) || Number(value) < 0) {
        const label = CARDIO_METRICS[key]?.label || key;
        setValidationMessage(`${label} must be a valid non-negative number`);
        return;
      }
    }

    const data = {};
    visibleMetrics.forEach((key) => {
      const value = metricValues[key];
      if (value !== undefined && value !== "") {
        data[key] = Number(value);
      }
    });

    onAddCardio({
      cardio: {
        activityType,
        variant: variant || null,
        data,
      },
    });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="add-cardio-modal-title">
        <button type="button" className="close-btn" onClick={closeModal} aria-label="Close">
          ✕
        </button>

        <h2 id="add-cardio-modal-title">Add Cardio</h2>

        <form onSubmit={handleSubmit}>
          <label htmlFor="cardio-activity-type">Activity Type</label>

          <select id="cardio-activity-type" value={activityType} onChange={handleActivityChange}>
            {CARDIO_ACTIVITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>

          {availableVariants.length > 0 && (
            <>
              <label htmlFor="cardio-variant">Variant (optional)</label>
              <select id="cardio-variant" value={variant} onChange={(e) => setVariant(e.target.value)}>
                <option value="">None</option>
                {availableVariants.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </>
          )}

          {visibleMetrics.map((key) => {
            const metric = CARDIO_METRICS[key];
            const isRequired = requiredMetrics.includes(key);

            return (
              <div key={key}>
                <label>
                  {metric?.label || key}
                  {metric?.unit ? ` (${metric.unit})` : ""}
                  {isRequired ? " *" : ""}
                </label>
                <div className="single-set-row">
                  <input
                    type="number"
                    placeholder={metric?.label || key}
                    value={metricValues[key] ?? ""}
                    onChange={(e) => handleMetricChange(key, e.target.value)}
                    min="0"
                    step="any"
                  />
                </div>
              </div>
            );
          })}

          {validationMessage && (
            <p className="form-error">{validationMessage}</p>
          )}

          <button className="save-btn" type="submit">
            Add Cardio
          </button>
        </form>
      </div>
    </div>
  );
}

export default AddCardioModal;
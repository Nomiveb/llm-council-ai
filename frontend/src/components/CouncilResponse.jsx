"use client";

import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import './CouncilResponse.css';

function shortModelName(model) {
  if (!model) return 'Model';
  return model.split('/').pop() || model;
}

function replaceAnonymousLabels(text, labelToModel) {
  if (!text || !labelToModel) return text || '';
  return Object.entries(labelToModel).reduce((result, [label, model]) => {
    return result.replaceAll(label, `**${shortModelName(model)}**`);
  }, text);
}

const STAGES = [
  {
    key: 'stage1',
    label: 'Individual responses',
    detail: 'Council models answer in parallel',
  },
  {
    key: 'stage2',
    label: 'Peer review',
    detail: 'The same models rank anonymized answers',
  },
  {
    key: 'stage3',
    label: 'Final answer',
    detail: 'Chairman model writes the synthesis',
  },
];

function StageHeader({ label, detail }) {
  return (
    <div className="stage-header">
      <span>{label}</span>
      {detail && <span className="stage-badge">{detail}</span>}
    </div>
  );
}

function IndividualResponses({ responses }) {
  const [activeIndex, setActiveIndex] = useState(0);
  if (!responses?.length) return null;

  const active = responses[activeIndex] || responses[0];

  return (
    <section className="council-stage">
      <StageHeader
        label="Individual responses"
        detail={`${responses.length} models`}
      />
      <div className="model-tabs" role="tablist" aria-label="Model responses">
        {responses.map((response, index) => (
          <button
            key={`${response.model}-${index}`}
            className={`model-tab ${index === activeIndex ? 'active' : ''}`}
            onClick={() => setActiveIndex(index)}
            role="tab"
            aria-selected={index === activeIndex}
          >
            {shortModelName(response.model)}
          </button>
        ))}
      </div>
      <div className="response-panel">
        <div className="panel-meta">
          <span>{active.model}</span>
        </div>
        <div className="markdown-content compact-markdown">
          <ReactMarkdown>{active.response}</ReactMarkdown>
        </div>
      </div>
    </section>
  );
}

function PeerReview({ rankings, labelToModel, aggregateRankings }) {
  const [activeIndex, setActiveIndex] = useState(0);
  if (!rankings?.length) return null;

  const active = rankings[activeIndex] || rankings[0];
  const aggregate = aggregateRankings || [];

  return (
    <section className="council-stage">
      <StageHeader label="Peer review" detail="cross-model" />
      <div className="review-note">
        Models reviewed anonymized answers. Labels are expanded here for
        readability.
      </div>

      {aggregate.length > 0 && (
        <div className="ranking-table-wrap">
          <table className="ranking-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Model</th>
                <th>Avg rank</th>
                <th>Votes</th>
              </tr>
            </thead>
            <tbody>
              {aggregate.map((row, index) => (
                <tr key={`${row.model}-${index}`}>
                  <td>{index + 1}</td>
                  <td>{shortModelName(row.model)}</td>
                  <td>{Number(row.average_rank).toFixed(2)}</td>
                  <td>{row.rankings_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="model-tabs" role="tablist" aria-label="Peer reviewers">
        {rankings.map((ranking, index) => (
          <button
            key={`${ranking.model}-${index}`}
            className={`model-tab ${index === activeIndex ? 'active' : ''}`}
            onClick={() => setActiveIndex(index)}
            role="tab"
            aria-selected={index === activeIndex}
          >
            {shortModelName(ranking.model)}
          </button>
        ))}
      </div>

      <div className="response-panel">
        <div className="panel-meta">
          <span>{active.model}</span>
        </div>
        {active.parsed_ranking?.length > 0 && (
          <div className="parsed-ranking-row">
            {active.parsed_ranking.map((label, index) => (
              <span key={`${label}-${index}`}>
                {index + 1}.{' '}
                {labelToModel?.[label]
                  ? shortModelName(labelToModel[label])
                  : label}
              </span>
            ))}
          </div>
        )}
        <div className="markdown-content compact-markdown">
          <ReactMarkdown>
            {replaceAnonymousLabels(active.ranking, labelToModel)}
          </ReactMarkdown>
        </div>
      </div>
    </section>
  );
}

function FinalAnswer({ finalResponse }) {
  if (!finalResponse) return null;
  return (
    <section className="council-stage">
      <StageHeader label="Final answer" />
      <div className="final-panel">
        <div className="panel-meta">
          <span>Chairman · {shortModelName(finalResponse.model)}</span>
        </div>
        <div className="markdown-content compact-markdown">
          <ReactMarkdown>{finalResponse.response}</ReactMarkdown>
        </div>
      </div>
    </section>
  );
}

function modelsForStage(stageKey, message) {
  const config = message.modelConfig || message.metadata?.model_config || {};
  if (stageKey === 'stage3') return [config.chairman_model].filter(Boolean);
  return config.council_models || [];
}

export function LoadingPipeline({ message }) {
  const activeStage = useMemo(() => {
    if (message.stage3) return 4;
    if (message.currentStage === 'complete') return 4;
    if (message.loading?.stage3 || message.currentStage === 'stage3') return 3;
    if (message.stage2 || message.currentStage === 'stage2_complete') return 3;
    if (message.loading?.stage2 || message.currentStage === 'stage2') return 2;
    if (message.stage1 || message.currentStage === 'stage1_complete') return 2;
    return 1;
  }, [message]);

  const activeLabel = activeStage <= 3 ? STAGES[activeStage - 1].label : 'Complete';

  return (
    <div className="loading-pipeline">
      <div className="pipeline-now">
        <span className="pulse-ring" />
        <div>
          <small>Current stage</small>
          <strong>{activeLabel}</strong>
        </div>
      </div>
      <div className="pipeline-steps">
      {STAGES.map(({ key, label, detail }, index) => {
        const stage = index + 1;
        const done = stage < activeStage;
        const active = stage === activeStage;
        const models = modelsForStage(key, message);
        return (
          <div className="pipeline-row" key={label}>
            <span className={`pipeline-dot ${done ? 'done' : ''} ${active ? 'active' : ''}`}>
              {done ? '✓' : stage}
            </span>
            <span>
              <strong>{label}</strong>
              <small>{detail}</small>
              {models.length > 0 && (
                <em>{models.map(shortModelName).join(' · ')}</em>
              )}
            </span>
          </div>
        );
      })}
      </div>
    </div>
  );
}

export default function CouncilResponse({ message }) {
  const hasLoading =
    message.loading?.stage1 || message.loading?.stage2 || message.loading?.stage3;
  const showPipeline =
    hasLoading || message.currentStage || message.stage1 || message.stage2 || message.stage3;

  return (
    <div className="council-response">
      {showPipeline && <LoadingPipeline message={message} />}
      {message.stage1 && <IndividualResponses responses={message.stage1} />}
      {message.stage2 && (
        <PeerReview
          rankings={message.stage2}
          labelToModel={message.metadata?.label_to_model}
          aggregateRankings={message.metadata?.aggregate_rankings}
        />
      )}
      {message.stage3 && <FinalAnswer finalResponse={message.stage3} />}
    </div>
  );
}

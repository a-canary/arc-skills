# Operations Workers (repos-dhw1)

Each live product has exactly one operations worker that deploys, restarts,
checks health, and pulls reviewed code into the live checkout. Nobody else
touches the live product.

## Live Products and Their Ops Workers

| Product | Lead | Ops Worker | Role File |
|---------|------|------------|-----------|
| Trading | trading-lead | trading-ops | ~/.pi/agent/roles/trading-ops.md |
| ndivisible app | ndv-lead | ndv-ops | ~/.pi/agent/roles/ndv-ops.md |
| WebUI | webui-expert | webui-ops | ~/.pi/agent/roles/webui-ops.md |
| Lane Proxy | inference-lead | laneproxy-ops | ~/.pi/agent/roles/laneproxy-ops.md |
| Live DB | any Lead | db-ops | ~/.pi/agent/roles/db-ops.md |
| Docker (general) | any Lead | docker-ops | ~/.pi/agent/roles/docker-ops.md |

## Model

All ops workers run Fable at high effort (ollama-cloud/fable).

## Rules (all ops workers)

- Only deploy/execute code or changes that have passed DefendMerge or Lead approval
- Back up before making changes
- Log every action with timestamp, context, and reason
- Roll back automatically on failure
- Report every action to the owning Lead
- No access to secrets or credentials beyond what the role needs

## Seat Bench

Each ops worker needs a seat bench of 10 scored tasks (repos-6xin), drawn
from real past operations of that product. Tasks should cover:
- Routine health check
- Deploy reviewed code
- Roll back a bad deploy
- Restart a failed service
- Handle an error condition
- etc.

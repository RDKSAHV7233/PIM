import { RecordStatus } from "@prisma/client";
import { canonicalWorkflowStatus, isValidWorkflowTransition, WORKFLOW_TRANSITIONS } from "./workflow-transitions";

describe("canonicalWorkflowStatus", () => {
  it("canonicalizes active to approved", () => {
    expect(canonicalWorkflowStatus(RecordStatus.active)).toBe("approved");
  });

  it("passes every other status through unchanged", () => {
    expect(canonicalWorkflowStatus(RecordStatus.draft)).toBe("draft");
    expect(canonicalWorkflowStatus(RecordStatus.in_review)).toBe("in_review");
    expect(canonicalWorkflowStatus(RecordStatus.approved)).toBe("approved");
    expect(canonicalWorkflowStatus(RecordStatus.rejected)).toBe("rejected");
    expect(canonicalWorkflowStatus(RecordStatus.archived)).toBe("archived");
  });
});

describe("isValidWorkflowTransition", () => {
  it("allows a status to transition to itself", () => {
    expect(isValidWorkflowTransition(RecordStatus.approved, RecordStatus.approved)).toBe(true);
  });

  it("treats active <-> approved as the same canonical status (no-op, always allowed)", () => {
    expect(isValidWorkflowTransition(RecordStatus.active, RecordStatus.approved)).toBe(true);
    expect(isValidWorkflowTransition(RecordStatus.approved, RecordStatus.active)).toBe(true);
  });

  it("allows approved -> draft (regression guard for #549 — this was the drifted entry)", () => {
    expect(isValidWorkflowTransition(RecordStatus.approved, RecordStatus.draft)).toBe(true);
  });

  it("allows archived -> draft (the Restore direction, BUG-ARCHIVE-SOFTDELETE-001 / PR #556)", () => {
    expect(isValidWorkflowTransition(RecordStatus.archived, RecordStatus.draft)).toBe(true);
  });

  it("allows any status to reach archived (Archive is reachable from anywhere)", () => {
    for (const status of [RecordStatus.draft, RecordStatus.in_review, RecordStatus.approved, RecordStatus.rejected]) {
      expect(isValidWorkflowTransition(status, RecordStatus.archived)).toBe(true);
    }
  });

  it("rejects approved -> in_review (un-approving directly, without going through draft, is not a modeled transition)", () => {
    expect(isValidWorkflowTransition(RecordStatus.approved, RecordStatus.in_review)).toBe(false);
  });

  it("rejects draft -> approved (must pass through in_review)", () => {
    expect(isValidWorkflowTransition(RecordStatus.draft, RecordStatus.approved)).toBe(false);
  });

  it("matches WORKFLOW_TRANSITIONS directly for every declared status", () => {
    for (const [from, allowedList] of Object.entries(WORKFLOW_TRANSITIONS)) {
      for (const to of allowedList) {
        expect(isValidWorkflowTransition(from as RecordStatus, to as RecordStatus)).toBe(true);
      }
    }
  });
});

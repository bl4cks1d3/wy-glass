import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { PlannerDb } from "../db";
import { PLANNER_DB } from "../database/database.module";
import { PlannerEventBus } from "../eventBus";
import { EventsService } from "../events/events.service";
import { VaultService } from "../vault/vault.service";
import * as researchRepo from "../repositories/research";
import type { PaperStatus } from "@planner-life/shared";

@Injectable()
export class ResearchService {
  private readonly logger = new Logger(ResearchService.name);

  constructor(
    @Inject(PLANNER_DB) private readonly db: PlannerDb,
    private readonly eventsService: EventsService,
    private readonly eventBus: PlannerEventBus,
    private readonly vault: VaultService
  ) {}

  listLines() {
    return researchRepo.listResearchLines(this.db);
  }

  createLine(input: { name: string; stage?: string; nextStep?: string }) {
    const line = researchRepo.createResearchLine(this.db, input);
    this.eventsService.record("research_line.created", { lineId: line.id, name: line.name });
    this.eventBus.publish("research_line.created", { lineId: line.id, name: line.name });
    return line;
  }

  updateLine(id: string, input: { stage?: string; nextStep?: string }) {
    const line = researchRepo.updateResearchLine(this.db, id, input);
    if (!line) {
      throw new NotFoundException("linha de pesquisa nao encontrada");
    }
    this.eventsService.record("research_line.updated", { lineId: id, stage: line.stage });
    this.eventBus.publish("research_line.updated", { lineId: id, stage: line.stage });
    return line;
  }

  removeLine(id: string) {
    researchRepo.deleteResearchLine(this.db, id);
    this.eventsService.record("research_line.deleted", { lineId: id });
    this.eventBus.publish("research_line.deleted", { lineId: id });
    return { ok: true };
  }

  listPapers(researchLineId?: string) {
    return researchRepo.listPapers(this.db, { researchLineId });
  }

  createPaper(input: {
    title: string;
    source?: string;
    researchLineId?: string;
    status?: PaperStatus;
    notePath?: string;
  }) {
    const paper = researchRepo.createPaper(this.db, input);
    this.eventsService.record("paper.created", { paperId: paper.id, title: paper.title });
    this.eventBus.publish("paper.created", { paperId: paper.id, title: paper.title });
    return paper;
  }

  updatePaperStatus(id: string, status: PaperStatus) {
    const paper = researchRepo.updatePaperStatus(this.db, id, status);
    if (!paper) {
      throw new NotFoundException("artigo nao encontrado");
    }
    this.eventsService.record("paper.updated", { paperId: id, status });
    this.eventBus.publish("paper.updated", { paperId: id, status });
    return paper;
  }

  updatePaperNotePath(id: string, notePath: string) {
    const paper = researchRepo.updatePaperNotePath(this.db, id, notePath);
    if (!paper) {
      throw new NotFoundException("artigo nao encontrado");
    }
    this.eventsService.record("paper.updated", { paperId: id, notePath });
    this.eventBus.publish("paper.updated", { paperId: id, notePath });
    return paper;
  }

  removePaper(id: string) {
    const paper = researchRepo.getPaper(this.db, id);
    researchRepo.deletePaper(this.db, id);
    if (paper?.notePath) {
      try {
        this.vault.remove(paper.notePath);
      } catch (err) {
        // nao deixa a exclusao do artigo falhar so porque a nota ja sumiu
        this.logger.warn(`falha ao apagar a nota "${paper.notePath}" do artigo ${id}: ${err instanceof Error ? err.message : err}`);
      }
    }
    this.eventsService.record("paper.deleted", { paperId: id });
    this.eventBus.publish("paper.deleted", { paperId: id });
    return { ok: true };
  }
}

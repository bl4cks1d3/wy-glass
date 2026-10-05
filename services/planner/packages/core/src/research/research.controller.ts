import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ResearchService } from "./research.service";
import type { PaperStatus } from "@planner-life/shared";

const VALID_PAPER_STATUSES: PaperStatus[] = ["na_fila", "em_leitura", "resumido"];

@Controller("research")
export class ResearchController {
  constructor(private readonly researchService: ResearchService) {}

  @Get("lines")
  listLines() {
    return this.researchService.listLines();
  }

  @Post("lines")
  createLine(@Body() body: { name?: string; stage?: string; nextStep?: string }) {
    if (!body?.name) {
      throw new BadRequestException("name e obrigatorio");
    }
    return this.researchService.createLine(body as { name: string; stage?: string; nextStep?: string });
  }

  @Patch("lines/:id")
  updateLine(@Param("id") id: string, @Body() body: { stage?: string; nextStep?: string }) {
    return this.researchService.updateLine(id, body);
  }

  @Delete("lines/:id")
  removeLine(@Param("id") id: string) {
    return this.researchService.removeLine(id);
  }

  @Get("papers")
  listPapers(@Query("researchLineId") researchLineId?: string) {
    return this.researchService.listPapers(researchLineId);
  }

  @Post("papers")
  createPaper(
    @Body()
    body: { title?: string; source?: string; researchLineId?: string; status?: string; notePath?: string }
  ) {
    if (!body?.title) {
      throw new BadRequestException("title e obrigatorio");
    }
    if (body.status && !VALID_PAPER_STATUSES.includes(body.status as PaperStatus)) {
      throw new BadRequestException("status invalido");
    }
    return this.researchService.createPaper(
      body as { title: string; source?: string; researchLineId?: string; status?: PaperStatus; notePath?: string }
    );
  }

  @Patch("papers/:id/status")
  updatePaperStatus(@Param("id") id: string, @Body() body: { status?: string }) {
    if (!body?.status || !VALID_PAPER_STATUSES.includes(body.status as PaperStatus)) {
      throw new BadRequestException("status invalido");
    }
    return this.researchService.updatePaperStatus(id, body.status as PaperStatus);
  }

  @Patch("papers/:id/note")
  updatePaperNote(@Param("id") id: string, @Body() body: { notePath?: string }) {
    if (!body?.notePath) {
      throw new BadRequestException("notePath e obrigatorio");
    }
    return this.researchService.updatePaperNotePath(id, body.notePath);
  }

  @Delete("papers/:id")
  removePaper(@Param("id") id: string) {
    return this.researchService.removePaper(id);
  }
}

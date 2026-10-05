import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { WorkspacesService } from "./workspaces.service";

type Body_ = Record<string, unknown>;

@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list() {
    return this.workspaces.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.workspaces.get(id);
  }

  @Post()
  create(@Body() body: Body_) {
    return this.workspaces.create(body ?? {});
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: Body_) {
    return this.workspaces.update(id, body ?? {});
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.workspaces.remove(id);
  }
}

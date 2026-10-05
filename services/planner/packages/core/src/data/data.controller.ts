import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { DataService } from "./data.service";

type Body_ = Record<string, unknown>;

@Controller("data/collections")
export class DataController {
  constructor(private readonly data: DataService) {}

  @Get()
  list() {
    return this.data.listCollections();
  }

  @Post()
  create(@Body() body: Body_) {
    return this.data.createCollection(body ?? {});
  }

  @Get(":name")
  get(@Param("name") name: string) {
    return this.data.getCollection(name);
  }

  @Patch(":name")
  update(@Param("name") name: string, @Body() body: Body_) {
    return this.data.updateCollection(name, body ?? {});
  }

  @Delete(":name")
  remove(@Param("name") name: string) {
    return this.data.removeCollection(name);
  }

  /** Filtros: ?campo=valor (igualdade), q (busca), sort, order, limit, offset. */
  @Get(":name/records")
  listRecords(@Param("name") name: string, @Query() query: Record<string, string | undefined>) {
    return this.data.listRecords(name, query);
  }

  @Post(":name/records")
  createRecord(@Param("name") name: string, @Body() body: Body_) {
    return this.data.createRecord(name, body ?? {});
  }

  @Patch(":name/records/:id")
  updateRecord(@Param("name") name: string, @Param("id") id: string, @Body() body: Body_) {
    return this.data.updateRecord(name, id, body ?? {});
  }

  @Delete(":name/records/:id")
  removeRecord(@Param("name") name: string, @Param("id") id: string) {
    return this.data.removeRecord(name, id);
  }
}

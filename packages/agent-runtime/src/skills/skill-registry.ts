import type { SkillDefinition, SkillDeclaration } from "./skill-types.js";

export const skillDefinitionKey = (id: string, version: string): string => `${id}@${version}`;

export class SkillRegistry {
  private readonly definitions = new Map<string, SkillDefinition>();

  register(definition: SkillDefinition): void {
    if (this.definitions.has(definition.id)) {
      throw new Error(`SKILL_ALREADY_REGISTERED:${definition.id}`);
    }
    this.definitions.set(definition.id, definition);
  }

  list(): SkillDefinition[] {
    return [...this.definitions.values()];
  }

  find(id: string): SkillDefinition | undefined {
    return this.definitions.get(id);
  }

  /** Resolve a list of declarations to their full definitions. */
  resolve(declarations: SkillDeclaration[]): SkillDefinition[] {
    return declarations
      .map((decl) => {
        const def = this.definitions.get(decl.id);
        if (!def) {
          throw new Error(`SKILL_NOT_FOUND:${decl.id}`);
        }
        return def;
      });
  }

  listByTag(tag: string): SkillDefinition[] {
    return [...this.definitions.values()].filter((def) => def.tags?.includes(tag));
  }
}

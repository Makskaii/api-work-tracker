import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { DirectoryClient } from './entities/directory-client.entity'
import { DirectoryProject } from './entities/directory-project.entity'
import { DirectoryStatus } from './entities/directory-status.entity'

@Injectable()
export class DirectoriesService {
  constructor(
    @InjectRepository(DirectoryProject)
    private readonly directoryProjectRepository: Repository<DirectoryProject>,
    @InjectRepository(DirectoryClient)
    private readonly directoryClientRepository: Repository<DirectoryClient>,
    @InjectRepository(DirectoryStatus)
    private readonly directoryStatusRepository: Repository<DirectoryStatus>,
  ) {}

  async getProjects() {
    return await this.directoryProjectRepository.find({
      order: { name: 'ASC' },
    })
  }

  async getClients() {
    return await this.directoryClientRepository.find({
      order: { name: 'ASC' },
    })
  }

  async getStatuses() {
    return await this.directoryStatusRepository.find({
      order: {
        sort: 'ASC',
        name: 'ASC',
      },
    })
  }
}

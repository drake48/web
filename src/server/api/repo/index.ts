import * as debug from 'debug';
import * as express from 'express';
import * as Octokit from '@octokit/rest';

import { Project, CircleCIRequesterConfig, SlackResponderConfig } from '../../db/models';
import { createA } from '../../helpers/a';
import { ReposResponse, SimpleProject, SimpleRepo } from '../../../common/types';

const d = debug('cfa:server:api:repo');
const a = createA(d);

export function repoRoutes() {
  const router = express();

  router.get(
    '/',
    a(async (req, res) => {
      // TODO: Should we really be storing this on session, is there a better
      // place to store them in a cache?
      let reposWithAdmin: SimpleRepo[] = req.session!.cachedRepos;
      if (!reposWithAdmin) {
        const github = new Octokit({
          auth: req.user.accessToken,
        });

        const allRepos: Octokit.ReposListForOrgResponseItem[] = await github.paginate(
          github.repos.list.endpoint.merge({
            per_page: 100,
          }),
        );

        reposWithAdmin = allRepos
          .filter(r => r.permissions.admin)
          .map(r => ({
            id: `${r.id}`,
            repoName: r.name,
            repoOwner: r.owner.login,
          }));
        req.session!.cachedRepos = reposWithAdmin;
      }

      const configured = await Project.findAll({
        where: {
          id: {
            $in: reposWithAdmin.map(r => r.id),
          },
          enabled: true,
        },
        include: Project.allIncludes,
      });

      // Due to the use of a cache above to avoid long GitHub API requests
      // we CAN NOT guaruntee that the user here has the "admin" level permission
      // still.  As such no important information should be returned in the
      // SimpleProject.  The secret should be stripped, and all request and respond
      // configs should be stripped to tiny amounts of information and no API keys
      // or ID's.
      const configuredMapped: SimpleProject[] = configured.map(p => ({
        id: p.id,
        repoName: p.repoName,
        repoOwner: p.repoOwner,
        requester_circleCI: !!p.requester_circleCI,
        requester_travisCI: !!p.requester_travisCI,
        responder_slack: p.responder_slack
          ? {
              team: p.responder_slack.teamName,
              channel: p.responder_slack.channelName,
            }
          : null,
      }));
      res.json({
        all: reposWithAdmin,
        configured: configuredMapped,
      });
    }),
  );

  return router;
}
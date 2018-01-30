#!/usr/bin/env node
// Downloads various README files from GitHub.

const async = require('async');
const fetch = require('node-fetch');
const fs = require('fs');

const CONCURRENT_REQUESTS = 20;

const addFrontMatter = (id, text) =>
`---
title: ${id}
sidebar_label: ${id.replace(/^babel-(plugin|proposal|preset)-/, '')}
---

${text}
`;

function getDirectoryListing(repo, branch = 'master') {
  let url = `https://api.github.com/repos/babel/${repo}/contents/packages?ref=${branch}`;
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    // This is intentionally using client_id and client_secret rather than an access_token
    // so that accidental exposure of the access token does not expose API access.
    // Passing client_id and client_secret *without* an access token is sufficient to hit the
    // increased rate limits.
    url += `&client_id=${encodeURIComponent(process.env.GITHUB_CLIENT_ID)}`
    url += `&client_secret=${encodeURIComponent(process.env.GITHUB_CLIENT_SECRET)}`;
  }

  return fetch(url)
    .then(res => res.json())
    .then(packages => ({ branch, packages, repo }));
}

function getReadmeURLsFromDirectoryListing({ branch, packages, repo }) {
  return packages
    .filter(file => file.type === 'dir')
    .map(file => ({
      name: file.name,
      uri: `/babel/${repo}/${branch}/${file.path}/README.md`,
    }));
}

console.log('Retrieving package listing...');
Promise.all([getDirectoryListing('babel', '6.x'), getDirectoryListing('minify')])
  .then(([babelPackages, babiliPackages]) => {
    const packages = [
      ...getReadmeURLsFromDirectoryListing(babelPackages),
      ...getReadmeURLsFromDirectoryListing(babiliPackages),
      // Special cases
      {
        name: 'babel-preset-env',
        uri: '/babel/babel-preset-env/1.x/README.md',
      },
      {
        name: 'babylon',
        uri: '/babel/babylon/master/README.md',
      },
    ];

    const plugins = [];
    const presets = [];
    const prefixes = ['preset', 'plugin', 'proposal'];

    console.log('Downloading READMEs...');

    const filtered = packages.reduce((result, p) => {
      const f = p.name.match(/^babel-([^-\s]+)-.*/);

      if (f && f.length && prefixes.indexOf(f[1]) > -1) {
        result.push(p);
      }

      return result;
    }, []);

    async.mapLimit(filtered, CONCURRENT_REQUESTS, (package, cb) => {
      fetch(`https://raw.githubusercontent.com${package.uri}`)
        .then(res => res.text())
        .then(
          text => {
            const filename = package.name.replace(/^babel-/, '');

            // This is extremely hacky/temporary, and simply mimics what we
            // were doing in the old jekyll setup in
            // _includes/package_readme.html. It only works because the READMEs
            // are generally standardized to start with:
            //
            // # babel-something
            //
            // > Some description
            //
            let parsedText = text.split('\n').slice(4).join('\n');

            // Adds the necessary frontmatter info for docusaurus
            parsedText = addFrontMatter(package.name, parsedText);

            fs.writeFile(`${__dirname}/../docs-v7/${filename}.md`, parsedText, cb);
          },
          err => {
            console.error(`Could not load ${package.name}: ${err}`);
          }
        );
    });
  })
  .catch(err => {
    console.error(`Could not retrieve package listing: ${err}`);
    process.exit(1);
  }
);

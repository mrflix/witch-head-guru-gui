'use strict';

var Guru = function (gurus) {
  this.accepts = function (question) {
    return Promise
      .all(gurus.map(function (guru) {
        return guru.accepts(question);
      }))
      .then(function (specialists) {
        var specialist = specialists
          .filter(function (specialist) {
            return !!specialist;
          })
          .shift();

        return specialist;
      });
  };

  this.ask = function (question) {
    return this.accepts(question)
      .then(function (specialist) {
        if (!specialist) {
          return Promise.resolve();
        }

        return specialist.ask(question);
      });
  };
};


var SparqlGuru = function (endpoint) {
  this.accepts = function (question) {
    return Promise.resolve(question.indexOf('SELECT') === 0 ? this : undefined);
  };

  this.ask = function (query) {
    return new Promise(function (resolve, reject) {
      var url = endpoint + '?query=' + encodeURIComponent(query);

      request({
        url: url,
        headers: {
          'Accept': 'application/json'
        }
      }, function (error, response, body) {
        if (error) {
          return reject(error);
        }

        resolve(JSON.parse(body));
      });
    });
  };
};


var NplGuru = function () {
  var synonyms = {
    'longness': 'length',
    'oldness': 'age',
    'tallness': 'height'
  };

  var getThing = function (name) {
    var query = 'SELECT DISTINCT ?s WHERE { ' +
      '?s a <http://www.w3.org/2002/07/owl#Thing> . ' +
      '?s <http://www.w3.org/2000/01/rdf-schema#label> ?label . ' +
      'FILTER (lcase(str(?label)) = "' + name + '") }';

    return guru.ask(query)
      .then(function (result) {
        result = result.results.bindings.shift();

        if (!result) {
          return undefined;
        }

        return result.s.value;
      });
  };

  var getProperty = function (name) {
    var query = 'SELECT DISTINCT ?s WHERE { ' +
      '?s a <http://www.w3.org/1999/02/22-rdf-syntax-ns#Property> . ' +
      '?s <http://www.w3.org/2000/01/rdf-schema#label> ?label . ' +
      'FILTER (lcase(str(?label)) = "' + name + '") }';

    return guru.ask(query)
      .then(function (result) {
        result = result.results.bindings.shift();

        if (!result) {
          return undefined;
        }

        return result.s.value;
      });
  };

  var getObject = function (subject, predicate) {
    var query = 'SELECT DISTINCT ?o WHERE { ' +
      '<' + subject + '> <' + predicate + '> ?o }';

    return guru.ask(query)
      .then(function (result) {
        result = result.results.bindings.shift();

        if (!result) {
          return undefined;
        }

        return result.o.value;
      });
  };

  var nounPredicates = function (question, subjects) {
    return nlp.pos(question).nouns()
      .map(function (noun) {
        if (subjects.indexOf(noun.normalised) >= 0) {
          return null;
        }

        return noun.normalised;
      })
      .filter(function (predicate) {
        return !!predicate;
      });
  };

  var adjectivePredicates = function (question) {
    return nlp.pos(question).adjectives()
      .map(function (adjective) {
        var noun = nlp.adjective(adjective.normalised).conjugate().noun;

        if (noun in synonyms) {
          noun = synonyms[noun];
        }

        return noun;
      });
  };

  this.accepts = function (question) {
    return Promise.resolve(question.slice(-1) === '?' ? this : undefined);
  };

  this.ask = function (question) {
    var possibleSubjects = nlp.spot(question)
      .map(function (spot) {
        return spot.normalised;
      })
      .filter(function (subject) {
        return !!subject;
      });

    var possiblePredicates = nounPredicates(question, possibleSubjects)
      .concat(adjectivePredicates(question, possibleSubjects));

    return Promise.all([
      Promise.all(possibleSubjects.map(function (subject) {
        return getThing(subject);
      })).then(function (subjects) {
        possibleSubjects = subjects.filter(function (subject) {
          return !!subject;
        });
      }),
      Promise.all(possiblePredicates.map(function (predicate) {
        return getProperty(predicate);
      })).then(function (predicates) {
        possiblePredicates = predicates.filter(function (predicate) {
          return !!predicate;
        });
      })]).then(function () {
        return getObject(possibleSubjects.shift(), possiblePredicates.shift());
      });
  };
};


var guru = new Guru([
  new SparqlGuru('http://dbpedia.org/sparql'),
  new NplGuru()
]);
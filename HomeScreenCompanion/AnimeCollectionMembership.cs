using System.Collections.Generic;
using System.Linq;

namespace HomeScreenCompanion
{
    internal static class AnimeCollectionMembership
    {
        // Only newly added members become owned. Existing manual members remain manual,
        // and members retained on uncertain mappings keep their previous ownership.
        internal static List<long> NextOwned(IEnumerable<long> previous,
            IEnumerable<long> added, IEnumerable<long> removed) =>
            previous.Except(removed).Concat(added).Distinct().OrderBy(id => id).ToList();
    }
}

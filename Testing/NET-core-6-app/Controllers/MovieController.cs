using Microsoft.AspNetCore.Mvc;
using MovieTracker.Models;

namespace MovieTracker.Controllers
{
    public class MovieController : Controller
    {
        // In-memory list to simulate a database
        private static List<Movie> _movies = new List<Movie>();
        private static int _nextId = 1;

        public IActionResult Index()
        {
            return View(_movies);
        }

        public IActionResult Add()
        {
            return View();
        }

        [HttpPost]
        public IActionResult Add(Movie movie)
        {
            movie.Id = _nextId++;
            _movies.Add(movie);
            return RedirectToAction("Index");
        }
    }
}
import { useEffect, useState, useRef } from 'react'
import config from './aws-exports'
import Amplify, { DataStore } from 'aws-amplify'
import { Post } from './models'
import { useKeyPressEvent, useUpdateEffect } from 'react-use'

Amplify.configure(config)

function App() {
  const [posts, setPosts] = useState([])
  useEffect(() => {
    const subscription = DataStore.observe(Post).subscribe((msg) => {
      DataStore.query(Post).then((posts) => setPosts(posts))
    })
    DataStore.query(Post).then(setPosts)

    return () => subscription && subscription.unsubscribe()
  }, [])
  return (
    <div className="App p-4">
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {posts.map((post) => (
            <LI key={post.id} post={post} />
          ))}
        </ul>
      </div>
    </div>
  )
}

const LI = ({ post }) => {
  const [edit, setEdit] = useState(false)
  const [title, setTitle] = useState(post.title)
  const ref = useRef(null)
  const predicate = (event) => {
    const match = event.key === 'Escape' && event.target === ref.current
    if (match) {
      console.log(`it's a match. event >`, JSON.stringify(event, null, 2))
    }
    return match
  }

  const handler = () => {
    setEdit(false)
  }

  const activate = (event) => {
    if (edit) return
    setEdit(true)
  }

  const submit = async (event) => {
    event.preventDefault()
    console.log(event)
    ref.current.blur()
    setEdit(false)
    await DataStore.save(
      Post.copyOf(post, (updated) => {
        updated.title = title
        updated.mysql_id = post.mysql_id
      })
    )
  }

  useKeyPressEvent(predicate, handler)

  useUpdateEffect(() => {
    ref.current.focus()
  }, [edit])

  return (
    <div className="flex items-center px-4 py-4 sm:px-6">
      <div className="min-w-0 flex-1 flex items-center">
        <div className="flex-shrink-0">
          <button
            type="button"
            className="inline-flex items-center px-2.5 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <svg
              className="w-5 h-5"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
        <div className="min-w-0 flex-1 items-center px-4 md:grid md:grid-cols-3 md:gap-4">
          <div onClick={activate}>
            <p
              className={`${
                edit ? 'hidden' : ''
              } text-sm font-medium text-indigo-600 truncate py-2 px-3 border border-transparent`}
            >
              {post.title}
            </p>
            <form onSubmit={submit}>
              <input
                ref={ref}
                onBlur={() => setEdit(false)}
                type="text"
                name="title"
                id="title"
                className={`${
                  !edit ? 'hidden' : ''
                } shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={post.title}
              />
            </form>
          </div>
          <div className="hidden md:block">
            <div>
              <ul className="text-sm text-gray-900">
                <li>id: {post.id}</li>
                <li>mysql_id: {post.mysql_id}</li>
                <li>version: {post._version}</li>
              </ul>
            </div>
          </div>
          <div className="hidden md:block">
            <div>
              <p className="text-sm text-gray-900">
                {new Date(post._lastChangedAt * 1000).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </div>
      <div>
        <svg
          className="h-5 w-5 text-gray-400"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
            clipRule="evenodd"
          />
        </svg>
      </div>
    </div>
  )
}

export default App
